package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strings"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

func (m *SessionManager) Fork(ctx context.Context, projectID, sessionID, cwd string) (SessionSummary, error) {
	admitted, err := m.projects.AssertCWD(projectID, cwd)
	if err != nil {
		return SessionSummary{}, err
	}
	entry, err := m.queueEntry(sessionID)
	if err != nil {
		return SessionSummary{}, err
	}
	defer m.releaseEntry(entry)
	if entry.projectID != projectID || entry.cwd != admitted {
		return SessionSummary{}, fmt.Errorf("unknown session: %s", sessionID)
	}
	if err := m.lockEntry(sessionID, entry); err != nil {
		return SessionSummary{}, err
	}
	defer entry.op.Unlock()
	finish, err := m.beginLifecycle(sessionID, entry)
	if err != nil {
		return SessionSummary{}, err
	}
	defer finish()
	if err := m.attachLocked(ctx, sessionID, entry); err != nil {
		return SessionSummary{}, err
	}
	ctx = entry.context(ctx)
	token := randomID()
	servers := make([]acp.UnstableMcpServer, 0)
	for _, server := range m.objectiveServers(token) {
		http := acp.UnstableMcpServerHttp(*server.Http)
		servers = append(servers, acp.UnstableMcpServer{Http: &http})
	}
	response, err := m.client.ForkSession(ctx, acp.UnstableForkSessionRequest{SessionId: acp.SessionId(sessionID), Cwd: admitted, McpServers: servers})
	if err != nil {
		return SessionSummary{}, err
	}
	value := objectValue(response)
	childID := textValue(value["sessionId"])
	if childID == "" || childID == sessionID {
		return SessionSummary{}, fmt.Errorf("Goose returned an invalid session identifier for a fork")
	}
	m.mu.Lock()
	_, exists := m.sessions[childID]
	m.mu.Unlock()
	if exists {
		return SessionSummary{}, fmt.Errorf("Goose returned an existing session identifier for a fork")
	}
	records, err := m.records.List()
	if err != nil {
		return SessionSummary{}, err
	}
	for _, record := range records {
		if record.SessionID == childID {
			return SessionSummary{}, fmt.Errorf("Goose returned an existing session identifier for a fork")
		}
	}
	_, err = m.client.Ready(ctx)
	if err != nil {
		return SessionSummary{}, err
	}
	child := newSessionEntry(childID, projectID, admitted, sessionID, token)
	child.configOptions = arrayValue(value["configOptions"])
	child.thinkingLevel = thinkingFromOptions(child.configOptions)
	child.model = modelFromSetup(child.configOptions, response.Meta)
	// Goose creates the child, but this controller has not replayed its inherited
	// transcript yet. The first read or prompt must load it from Goose.
	if err := m.records.Record(ProjectSessionRecord{ProjectID: projectID, SessionID: childID, CWD: admitted, ParentSessionID: sessionID}); err != nil {
		return SessionSummary{}, err
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return SessionSummary{}, fmt.Errorf("session manager has been shut down")
	}
	m.sessions[childID] = child
	m.mu.Unlock()
	summary := m.summary(childID, child)
	m.emit("session.lifecycleChanged", map[string]any{"projectId": projectID, "sessionId": childID, "operation": "forked"})
	return summary, nil
}

func (m *SessionManager) Rename(ctx context.Context, projectID, sessionID, cwd, title string) error {
	title = strings.TrimSpace(title)
	if title == "" || strings.ContainsRune(title, 0) || utf16Length(title) > 200 {
		return fmt.Errorf("session title is invalid")
	}
	entry, err := m.EnsureAttached(ctx, sessionID, projectID, cwd)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	if _, err := m.client.Call(entry.context(ctx), "_goose/unstable/session/rename", map[string]any{"sessionId": sessionID, "title": title}); err != nil {
		return err
	}
	entry.state.Lock()
	entry.title = title
	entry.state.Unlock()
	m.history.Forget(sessionID)
	m.emit("session.lifecycleChanged", map[string]any{"projectId": projectID, "sessionId": sessionID, "operation": "renamed", "title": title})
	return nil
}

func (m *SessionManager) Archive(ctx context.Context, projectID, sessionID, cwd string) error {
	admitted, err := m.projects.AssertCWD(projectID, cwd)
	if err != nil {
		return err
	}
	entry, err := m.queueEntry(sessionID)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if entry.projectID != projectID || entry.cwd != admitted {
		return fmt.Errorf("unknown session: %s", sessionID)
	}
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	entry.state.Lock()
	queued := queuedFollowUpCount(entry.queue) > 0
	entry.state.Unlock()
	if queued {
		return fmt.Errorf("remove or finish queued follow-ups before archiving the chat")
	}
	finish, err := m.beginLifecycle(sessionID, entry)
	if err != nil {
		return err
	}
	defer finish()
	if err := m.attachLocked(ctx, sessionID, entry); err != nil {
		return err
	}
	if _, err := m.client.Call(entry.context(ctx), "_goose/unstable/session/archive", map[string]any{"sessionId": sessionID}); err != nil {
		return err
	}
	m.cancelPermissions(sessionID)
	m.mu.Lock()
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	m.history.Forget(sessionID)
	m.emit("session.lifecycleChanged", map[string]any{"projectId": projectID, "sessionId": sessionID, "operation": "archived"})
	return nil
}

func (m *SessionManager) Unarchive(ctx context.Context, projectID, sessionID string) error {
	finish, err := m.beginLifecycle(sessionID, nil)
	if err != nil {
		return err
	}
	defer finish()
	records, err := m.records.List()
	if err != nil {
		return err
	}
	found := false
	for _, record := range records {
		if record.ProjectID == projectID && record.SessionID == sessionID {
			if _, err := m.projects.AssertCWD(projectID, record.CWD); err != nil {
				return err
			}
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("unknown session: %s", sessionID)
	}
	if _, err := m.client.Call(ctx, "_goose/unstable/session/unarchive", map[string]any{"sessionId": sessionID}); err != nil {
		return err
	}
	m.emit("session.lifecycleChanged", map[string]any{"projectId": projectID, "sessionId": sessionID, "operation": "unarchived"})
	return nil
}

func (m *SessionManager) Delete(ctx context.Context, projectID, sessionID, cwd string) error {
	admitted, err := m.projects.AssertCWD(projectID, cwd)
	if err != nil {
		return err
	}
	entry, err := m.queueEntry(sessionID)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if entry.projectID != projectID || entry.cwd != admitted {
		return fmt.Errorf("unknown session: %s", sessionID)
	}
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	finish, err := m.beginLifecycle(sessionID, entry)
	if err != nil {
		return err
	}
	defer finish()
	if err := m.attachLocked(ctx, sessionID, entry); err != nil {
		return err
	}
	if err := m.client.DeleteSession(entry.context(ctx), sessionID); err != nil {
		return err
	}
	m.cancelPermissions(sessionID)
	m.mu.Lock()
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	m.history.Forget(sessionID)
	var cleanup []error
	if err := m.records.Forget(projectID, sessionID); err != nil {
		cleanup = append(cleanup, fmt.Errorf("remove session association: %w", err))
	}
	if err := m.objectives.ClearGoal(projectID, sessionID); err != nil {
		cleanup = append(cleanup, fmt.Errorf("remove session objective: %w", err))
	}
	if m.queues != nil {
		if err := m.queues.Forget(projectID, sessionID); err != nil {
			cleanup = append(cleanup, fmt.Errorf("remove session queue: %w", err))
		}
	}
	m.emit("session.deleted", map[string]any{"projectId": projectID, "sessionId": sessionID})
	return errors.Join(cleanup...)
}

func (m *SessionManager) ObjectiveOwner(token string) (string, string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for sessionID, entry := range m.sessions {
		if entry.objectiveToken == token {
			return entry.projectID, sessionID, true
		}
	}
	return "", "", false
}

func (m *SessionManager) Stats(sessionID string) (SessionStats, error) {
	entry, err := m.entry(sessionID)
	if err != nil {
		return SessionStats{}, err
	}
	defer m.releaseEntry(entry)
	entry.state.Lock()
	defer entry.state.Unlock()
	stats := entry.stats
	stats.Reported = maps.Clone(stats.Reported)
	stats.ContextUsage = maps.Clone(stats.ContextUsage)
	return stats, nil
}

func (m *SessionManager) ClampThinking(sessionID, requested string) (string, error) {
	entry, err := m.entry(sessionID)
	if err != nil {
		return "", err
	}
	defer m.releaseEntry(entry)
	entry.state.Lock()
	defer entry.state.Unlock()
	var values []string
	current := "off"
	for _, candidate := range entry.configOptions {
		option := mapValue(candidate)
		if option["id"] != "thinking_effort" {
			continue
		}
		if value := textValue(option["currentValue"]); value != "" {
			current = value
		}
		for _, raw := range arrayValue(option["options"]) {
			item := mapValue(raw)
			if nested := arrayValue(item["options"]); len(nested) > 0 {
				for _, child := range nested {
					values = append(values, textValue(mapValue(child)["value"]))
				}
			} else {
				values = append(values, textValue(item["value"]))
			}
		}
	}
	if len(values) == 0 {
		return current, nil
	}
	for _, value := range values {
		if value == requested {
			return requested, nil
		}
	}
	scale := []string{"off", "minimal", "low", "medium", "high", "xhigh"}
	requestedIndex := stringIndex(scale, requested)
	if requestedIndex < 0 {
		requestedIndex = 0
	}
	closest := values[0]
	for _, value := range values[1:] {
		if absolute(stringIndex(scale, value)-requestedIndex) < absolute(stringIndex(scale, closest)-requestedIndex) {
			closest = value
		}
	}
	return closest, nil
}

func (m *SessionManager) ListWithFallback(ctx context.Context, projectID string, archived any) ([]SessionSummary, error) {
	return m.List(ctx, projectID, archived)
}

func (m *SessionManager) info(ctx context.Context, sessionID string) (remoteSession, error) {
	response, err := m.client.Call(ctx, "_goose/unstable/session/info", map[string]any{"sessionId": sessionID})
	if err != nil {
		return remoteSession{}, err
	}
	var value map[string]any
	if json.Unmarshal(response, &value) != nil {
		return remoteSession{}, fmt.Errorf("Goose session info is invalid")
	}
	session := mapValue(value["session"])
	if session["sessionId"] == nil {
		session["sessionId"] = sessionID
	}
	meta := mapValue(session["_meta"])
	archived := session["archived"] == true || meta["archivedAt"] != nil || session["archivedAt"] != nil
	title := textValue(session["title"])
	if title == "" {
		title = "Chat"
	}
	updated := timeNowMillis()
	if parsed, err := parseTimestamp(textValue(session["updatedAt"])); err == nil {
		updated = parsed
	}
	return remoteSession{title: title, updatedAt: updated, messageCount: int(integerValue(firstNonNil(session["messageCount"], meta["messageCount"]))), archived: archived}, nil
}

func stringIndex(values []string, wanted string) int {
	for index, value := range values {
		if value == wanted {
			return index
		}
	}
	return -1
}
func absolute(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
func timeNowMillis() int64 { return time.Now().UnixMilli() }
func parseTimestamp(value string) (int64, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	return parsed.UnixMilli(), err
}
