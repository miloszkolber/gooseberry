package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	acp "github.com/coder/acp-go-sdk"
)

type ImageContent struct {
	Type     string `json:"type"`
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

func (m *SessionManager) Prompt(ctx context.Context, sessionID, text string, images []ImageContent) error {
	entry, err := m.entry(sessionID)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	if err := m.attachLocked(ctx, sessionID, entry); err != nil {
		return err
	}
	return m.startPromptLocked(sessionID, entry, text, images)
}

func (m *SessionManager) Queue(ctx context.Context, sessionID, text string) error {
	entry, err := m.entry(sessionID)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	text, err = queuedText(text)
	if err != nil {
		return err
	}
	if err := m.attachLocked(ctx, sessionID, entry); err != nil {
		return err
	}
	entry.state.Lock()
	streaming := entry.streaming
	entry.state.Unlock()
	if !streaming {
		return m.startPromptLocked(sessionID, entry, text, nil)
	}
	entry.state.Lock()
	defer entry.state.Unlock()
	if len(entry.queue.FollowUp) >= maxQueuedMessages {
		return fmt.Errorf("a chat can queue at most %d messages", maxQueuedMessages)
	}
	entry.queue.FollowUp = append(entry.queue.FollowUp, text)
	m.emitQueue(sessionID, entry)
	return nil
}

func (m *SessionManager) EditQueue(sessionID, lane string, index int, text, revision string) error {
	entry, err := m.entry(sessionID)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	entry.state.Lock()
	defer entry.state.Unlock()
	if revision == "" {
		return fmt.Errorf("reload Gooseberry before editing queued messages")
	}
	if revision != entry.queue.Revision {
		return fmt.Errorf("the queue changed; reopen the queued message before editing it")
	}
	queue, err := queueLane(entry, lane)
	if err != nil {
		return err
	}
	if index < 0 || index >= len(*queue) {
		return fmt.Errorf("queued message not found")
	}
	text, err = queuedText(text)
	if err != nil {
		return err
	}
	(*queue)[index] = text
	m.emitQueue(sessionID, entry)
	return nil
}

func (m *SessionManager) RemoveQueue(sessionID, lane string, index int, revision string) error {
	entry, err := m.entry(sessionID)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	entry.state.Lock()
	defer entry.state.Unlock()
	if revision == "" {
		return fmt.Errorf("reload Gooseberry before removing queued messages")
	}
	if revision != entry.queue.Revision {
		return fmt.Errorf("the queue changed; refresh the queued message before removing it")
	}
	queue, err := queueLane(entry, lane)
	if err != nil {
		return err
	}
	if index < 0 || index >= len(*queue) {
		return fmt.Errorf("queued message not found")
	}
	*queue = append((*queue)[:index], (*queue)[index+1:]...)
	m.emitQueue(sessionID, entry)
	return nil
}

func (m *SessionManager) Steer(ctx context.Context, sessionID, text string, images []ImageContent) error {
	entry, err := m.entry(sessionID)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	if err := m.attachLocked(ctx, sessionID, entry); err != nil {
		return err
	}
	entry.state.Lock()
	runID := entry.runID
	entry.state.Unlock()
	if runID == "" {
		return fmt.Errorf("Goose has not supplied a steerable run id")
	}
	prompt, err := promptBlocks(text, images)
	if err != nil {
		return err
	}
	response, err := m.client.Call(entry.context(ctx), "_goose/unstable/session/steer", map[string]any{"sessionId": sessionID, "expectedRunId": runID, "prompt": prompt})
	if err != nil {
		return err
	}
	var value map[string]any
	if json.Unmarshal(response, &value) != nil || textValue(value["runId"]) == "" {
		return fmt.Errorf("Goose steer response is invalid")
	}
	entry.state.Lock()
	entry.runID = textValue(value["runId"])
	entry.state.Unlock()
	return nil
}

func (m *SessionManager) Abort(ctx context.Context, sessionID string) error {
	entry, err := m.entry(sessionID)
	if err != nil {
		return err
	}
	defer m.releaseEntry(entry)
	if err := m.lockEntry(sessionID, entry); err != nil {
		return err
	}
	defer entry.op.Unlock()
	if err := m.attachLocked(ctx, sessionID, entry); err != nil {
		return err
	}
	m.cancelPermissions(sessionID)
	return m.client.Cancel(entry.context(ctx), sessionID)
}

func (m *SessionManager) startPromptLocked(sessionID string, entry *sessionEntry, text string, images []ImageContent) error {
	prompt, err := promptBlocks(text, images)
	if err != nil {
		return err
	}
	content := any(text)
	echoImages := make([]map[string]any, 0, len(images))
	if len(images) > 0 {
		blocks := []any{map[string]any{"type": "text", "text": text}}
		for _, image := range images {
			block := map[string]any{"type": "image", "data": image.Data, "mimeType": image.MimeType}
			blocks = append(blocks, block)
			echoImages = append(echoImages, block)
		}
		content = blocks
	}
	entry.state.Lock()
	entry.messages = append(entry.messages, map[string]any{"role": "user", "content": content})
	entry.pendingEcho = &userEcho{text: text, images: echoImages, matched: make([]bool, len(echoImages))}
	entry.stats.TotalMessages = len(entry.messages)
	entry.streaming = true
	entry.promptGeneration++
	generation := entry.promptGeneration
	entry.state.Unlock()
	m.emit("agent.event", map[string]any{"sessionId": sessionID, "event": map[string]any{"type": "run-start"}})
	m.mu.Lock()
	entry.refs++
	m.mu.Unlock()
	promptContext := entry.context(context.Background())
	go func() {
		defer m.releaseEntry(entry)
		response, promptErr := m.client.Prompt(promptContext, acp.PromptRequest{SessionId: acp.SessionId(sessionID), Prompt: prompt})
		if err := m.lockEntry(sessionID, entry); err != nil {
			return
		}
		defer entry.op.Unlock()
		entry.state.Lock()
		if entry.promptGeneration != generation {
			entry.state.Unlock()
			return
		}
		entry.streaming = false
		if promptErr != nil {
			entry.settlement = &SessionSettlement{StopReason: "error", ErrorMessage: promptErr.Error()}
			entry.state.Unlock()
			m.emit("agent.event", map[string]any{"sessionId": sessionID, "event": map[string]any{"type": "error", "error": promptErr.Error()}})
			return
		}
		stopReason := string(response.StopReason)
		if stopReason == "" {
			stopReason = "complete"
		}
		entry.settlement = &SessionSettlement{StopReason: stopReason}
		entry.state.Unlock()
		m.emit("agent.event", map[string]any{"sessionId": sessionID, "event": map[string]any{"type": "complete", "status": stopReason}})
		m.scheduleFollowUp(sessionID, entry)
	}()
	return nil
}

func (m *SessionManager) scheduleFollowUp(sessionID string, entry *sessionEntry) {
	m.mu.Lock()
	entry.state.Lock()
	if m.closed || m.sessions[sessionID] != entry || m.lifecycle[sessionID] || entry.drainScheduled || entry.streaming || len(entry.queue.FollowUp) == 0 {
		entry.state.Unlock()
		m.mu.Unlock()
		return
	}
	entry.drainScheduled = true
	entry.refs++
	entry.state.Unlock()
	m.mu.Unlock()
	go func() {
		defer m.releaseEntry(entry)
		err := m.lockEntry(sessionID, entry)
		if err == nil {
			defer entry.op.Unlock()
		}
		defer func() {
			entry.state.Lock()
			entry.drainScheduled = false
			entry.state.Unlock()
		}()
		if err == nil {
			m.drainFollowUp(sessionID, entry)
		}
	}()
}

func (m *SessionManager) drainFollowUp(sessionID string, entry *sessionEntry) {
	entry.state.Lock()
	ready := !entry.streaming && len(entry.queue.FollowUp) > 0
	entry.state.Unlock()
	if !ready {
		return
	}
	// A reconnect must load the session successfully before consuming its queue.
	if err := m.attachLocked(context.Background(), sessionID, entry); err != nil {
		return
	}
	entry.state.Lock()
	if entry.streaming || len(entry.queue.FollowUp) == 0 {
		entry.state.Unlock()
		return
	}
	text := entry.queue.FollowUp[0]
	entry.queue.FollowUp = append([]string(nil), entry.queue.FollowUp[1:]...)
	m.emitQueue(sessionID, entry)
	entry.state.Unlock()
	_ = m.startPromptLocked(sessionID, entry, text, nil)
}

// Called with entry.state held immediately after a queue mutation. An opaque
// revision also distinguishes identical messages and newly loaded projections.
func (m *SessionManager) emitQueue(sessionID string, entry *sessionEntry) {
	entry.queue.Revision = randomID()
	m.emit("agent.event", map[string]any{"sessionId": sessionID, "event": map[string]any{"type": "queue_update", "revision": entry.queue.Revision, "steering": append([]string{}, entry.queue.Steering...), "followUp": append([]string{}, entry.queue.FollowUp...)}})
}

func (m *SessionManager) cancelPermissions(sessionID string) {
	m.mu.Lock()
	pending := make([]*pendingPermission, 0)
	for id, permission := range m.permissions {
		if permission.sessionID == sessionID {
			pending = append(pending, permission)
			delete(m.permissions, id)
		}
	}
	m.mu.Unlock()
	for _, permission := range pending {
		select {
		case permission.result <- acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}:
		default:
		}
	}
}

func promptBlocks(text string, images []ImageContent) ([]acp.ContentBlock, error) {
	blocks := []acp.ContentBlock{acp.TextBlock(text)}
	total := 0
	for _, image := range images {
		if image.Type != "image" || (image.MimeType != "image/png" && image.MimeType != "image/jpeg" && image.MimeType != "image/gif" && image.MimeType != "image/webp") || !canonicalBase64(image.Data) {
			return nil, fmt.Errorf("malformed session image")
		}
		if len(image.Data) > int(4.5*1024*1024) {
			return nil, fmt.Errorf("session image exceeds the 4.5 MiB encoded size limit")
		}
		total += len(image.Data)
		if total > 24*1024*1024 {
			return nil, fmt.Errorf("session images exceed the 24 MiB aggregate encoded size limit")
		}
		blocks = append(blocks, acp.ImageBlock(image.Data, image.MimeType))
	}
	return blocks, nil
}

func canonicalBase64(value string) bool {
	if value == "" || len(value)%4 != 0 {
		return false
	}
	padding := 0
	if value[len(value)-1] == '=' {
		padding++
		if value[len(value)-2] == '=' {
			padding++
		}
	}
	for index := 0; index < len(value)-padding; index++ {
		if base64Index(value[index]) < 0 {
			return false
		}
	}
	for index := len(value) - padding; index < len(value); index++ {
		if value[index] != '=' {
			return false
		}
	}
	if padding == 2 {
		return base64Index(value[len(value)-3])&15 == 0
	}
	if padding == 1 {
		return base64Index(value[len(value)-2])&3 == 0
	}
	return true
}

func base64Index(value byte) int {
	switch {
	case value >= 'A' && value <= 'Z':
		return int(value - 'A')
	case value >= 'a' && value <= 'z':
		return int(value-'a') + 26
	case value >= '0' && value <= '9':
		return int(value-'0') + 52
	case value == '+':
		return 62
	case value == '/':
		return 63
	default:
		return -1
	}
}

func queuedText(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("queued message cannot be empty")
	}
	return value, nil
}

func queueLane(entry *sessionEntry, lane string) (*[]string, error) {
	if lane == "steering" {
		return &entry.queue.Steering, nil
	}
	if lane == "followUp" {
		return &entry.queue.FollowUp, nil
	}
	return nil, fmt.Errorf("unknown queue lane")
}
