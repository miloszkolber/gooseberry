package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

const (
	maxQueuedMessages          = 20
	inactiveProjectionMaxCount = 24
	inactiveProjectionMaxBytes = 8 * 1024 * 1024
	permissionTimeout          = 5 * time.Minute
)

type SessionPublisher func(channel string, data any)

type sessionEntry struct {
	op    sync.Mutex
	state sync.Mutex
	// Protected by SessionManager.mu, including while waiting for op.
	refs      int
	ephemeral bool

	projectID         string
	cwd               string
	parentSessionID   string
	title             string
	model             *WireModel
	thinkingLevel     string
	configOptions     []any
	messages          []any
	streaming         bool
	settlement        *SessionSettlement
	stats             SessionStats
	queue             SessionQueue
	runID             string
	objectiveToken    string
	attached          uint64
	replay            *sessionEntry
	promptGeneration  uint64
	inactiveAt        time.Time
	inactiveBytes     int // Encoded size under state; zero means a mutation needs recounting.
	pendingEcho       *userEcho
	consumedQuestions map[string]bool
	drainScheduled    bool
}

type userEcho struct {
	text    string
	offset  int
	images  []map[string]any
	matched []bool
}

type pendingPermission struct {
	sessionID string
	request   acp.RequestPermissionRequest
	result    chan acp.RequestPermissionResponse
}

type pendingQuestion struct {
	sessionID string
	args      map[string]any
	result    chan map[string]any
}

type sessionLease struct {
	ProjectID string `json:"projectId"`
	SessionID string `json:"sessionId"`
}

type clientSessionLeases struct {
	revision uint64
	sessions map[string]string // Session ID to project ID; owned by SessionManager.mu.
}

type SessionManager struct {
	mu           sync.Mutex
	closed       bool
	client       *GooseClient
	projects     *Projects
	policy       *PathPolicy
	records      *SessionRecords
	objectives   *Objectives
	objectiveURL string
	sessions     map[string]*sessionEntry
	leases       map[string]*clientSessionLeases
	lifecycle    map[string]bool
	permissions  map[string]*pendingPermission
	questions    map[string]*pendingQuestion
	publish      SessionPublisher
	now          func() time.Time
	deviceCode   func(map[string]any)
	history      *HistoryIndex
}

func NewSessionManager(projects *Projects, policy *PathPolicy, records *SessionRecords, objectives *Objectives, publish SessionPublisher) *SessionManager {
	manager := &SessionManager{projects: projects, policy: policy, records: records, objectives: objectives, sessions: make(map[string]*sessionEntry), permissions: make(map[string]*pendingPermission), questions: make(map[string]*pendingQuestion), publish: publish, now: time.Now}
	manager.history = newHistoryIndex(manager)
	return manager
}

func (m *SessionManager) SetClient(client *GooseClient) { m.client = client }
func (m *SessionManager) SetObjectiveURL(url string)    { m.objectiveURL = url }

func (m *SessionManager) RecordedCWD(projectID, sessionID string) (string, error) {
	records, err := m.records.List()
	if err != nil {
		return "", err
	}
	for _, record := range records {
		if record.ProjectID == projectID && record.SessionID == sessionID {
			return record.CWD, nil
		}
	}
	return "", fmt.Errorf("unknown session: %s", sessionID)
}

func (m *SessionManager) Create(ctx context.Context, projectID, cwd string, model *WireModel, thinking, clientKey string) (map[string]any, error) {
	if m.client == nil {
		return nil, fmt.Errorf("Goose client is not configured")
	}
	admitted, err := m.projects.AssertCWD(projectID, cwd)
	if err != nil {
		return nil, err
	}
	token := randomID()
	generation, err := m.client.Ready(ctx)
	if err != nil {
		return nil, err
	}
	ctx = context.WithValue(ctx, connectionGenerationKey{}, generation)
	response, err := m.client.NewSession(ctx, acp.NewSessionRequest{Cwd: admitted, McpServers: m.objectiveServers(token), Meta: map[string]any{"projectId": projectID}})
	if err != nil {
		return nil, err
	}
	sessionID := string(response.SessionId)
	if sessionID == "" {
		return nil, fmt.Errorf("Goose response is missing sessionId")
	}
	_, err = m.client.Ready(ctx)
	if err != nil {
		return nil, err
	}
	entry := newSessionEntry(sessionID, projectID, admitted, "", token)
	entry.configOptions = jsonValues(response.ConfigOptions)
	entry.thinkingLevel = thinkingFromOptions(entry.configOptions)
	entry.model = modelFromSetup(entry.configOptions, response.Meta)
	entry.attached = generation
	if err := m.records.Record(ProjectSessionRecord{ProjectID: projectID, SessionID: sessionID, CWD: admitted}); err != nil {
		return nil, err
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil, fmt.Errorf("session manager has been shut down")
	}
	m.sessions[sessionID] = entry
	entry.refs++ // Configuration and the response must survive concurrent lease reconciliation.
	m.retainSessionLocked(clientKey, sessionID, projectID)
	m.mu.Unlock()
	defer m.releaseEntry(entry)
	m.emit("session.lifecycleChanged", map[string]any{"projectId": projectID, "sessionId": sessionID, "operation": "created"})
	if model != nil {
		if err := m.SetModel(ctx, sessionID, *model); err != nil {
			return nil, err
		}
	}
	if thinking != "" {
		if err := m.SetThinking(ctx, sessionID, thinking); err != nil {
			return nil, err
		}
	}
	entry.state.Lock()
	createdModel, createdThinking := entry.model, entry.thinkingLevel
	entry.state.Unlock()
	return map[string]any{"sessionId": sessionID, "model": createdModel, "thinkingLevel": createdThinking}, nil
}

func (m *SessionManager) EnsureAttached(ctx context.Context, sessionID, projectID, cwd string) (*sessionEntry, error) {
	if m.client == nil {
		return nil, fmt.Errorf("Goose client is not configured")
	}
	admitted, err := m.projects.AssertCWD(projectID, cwd)
	if err != nil {
		return nil, err
	}
	entry, _ := m.entry(sessionID)
	if entry == nil {
		records, err := m.records.List()
		if err != nil {
			return nil, err
		}
		var record *ProjectSessionRecord
		for index := range records {
			candidate := &records[index]
			if candidate.ProjectID == projectID && candidate.SessionID == sessionID && candidate.CWD == admitted {
				record = candidate
				break
			}
		}
		if record == nil {
			return nil, fmt.Errorf("unknown session: %s", sessionID)
		}
		entry = newSessionEntry(sessionID, projectID, admitted, record.ParentSessionID, randomID())
		m.mu.Lock()
		if m.closed || m.lifecycle[sessionID] {
			m.mu.Unlock()
			return nil, fmt.Errorf("wait for the chat lifecycle operation to finish")
		}
		if existing := m.sessions[sessionID]; existing != nil {
			entry = existing
		} else {
			m.sessions[sessionID] = entry
		}
		entry.refs++
		m.mu.Unlock()
	}
	if entry.projectID != projectID || entry.cwd != admitted {
		m.releaseEntry(entry)
		return nil, fmt.Errorf("unknown session: %s", sessionID)
	}
	if err := m.lockEntry(sessionID, entry); err != nil {
		m.releaseEntry(entry)
		return nil, err
	}
	err = m.attachLocked(ctx, sessionID, entry)
	entry.op.Unlock()
	if err != nil {
		m.releaseEntry(entry)
		return nil, err
	}
	return entry, nil
}

func (m *SessionManager) attachLocked(ctx context.Context, sessionID string, entry *sessionEntry) error {
	m.mu.Lock()
	current := !m.closed && m.sessions[sessionID] == entry
	m.mu.Unlock()
	if !current {
		return fmt.Errorf("session changed while waiting for an operation")
	}
	cwd, err := m.RecordedCWD(entry.projectID, sessionID)
	if err != nil || cwd != entry.cwd {
		return fmt.Errorf("unknown session: %s", sessionID)
	}
	if _, err := m.projects.AssertCWD(entry.projectID, cwd); err != nil {
		return err
	}
	generation, err := m.client.Ready(ctx)
	if err != nil {
		return err
	}
	entry.state.Lock()
	alreadyAttached := entry.attached == generation
	entry.state.Unlock()
	if alreadyAttached {
		m.scheduleFollowUp(sessionID, entry)
		return nil
	}
	entry.state.Lock()
	replay := newSessionEntry(sessionID, entry.projectID, entry.cwd, entry.parentSessionID, entry.objectiveToken)
	replay.title = entry.title
	replay.attached = generation
	entry.replay = replay
	entry.state.Unlock()
	ctx = context.WithValue(ctx, connectionGenerationKey{}, generation)
	response, err := m.client.LoadSession(ctx, acp.LoadSessionRequest{SessionId: acp.SessionId(sessionID), Cwd: entry.cwd, McpServers: m.objectiveServers(entry.objectiveToken)})
	if err == nil {
		var currentGeneration uint64
		currentGeneration, err = m.client.Ready(ctx)
		if err == nil && currentGeneration != generation {
			err = fmt.Errorf("Goose ACP connection changed while loading the session")
		}
	}
	if err != nil {
		entry.state.Lock()
		entry.replay = nil
		entry.state.Unlock()
		return err
	}
	entry.state.Lock()
	replay.configOptions = jsonValues(response.ConfigOptions)
	replay.model = modelFromSetup(replay.configOptions, response.Meta)
	replay.thinkingLevel = thinkingFromOptions(replay.configOptions)
	replay.attached = generation
	replay.queue = entry.queue
	replay.stats.TotalMessages = len(replay.messages)
	entry.title = replay.title
	entry.model = replay.model
	entry.thinkingLevel = replay.thinkingLevel
	entry.configOptions = replay.configOptions
	entry.messages = replay.messages
	entry.streaming = replay.streaming
	entry.settlement = replay.settlement
	entry.stats = replay.stats
	entry.queue = replay.queue
	entry.runID = replay.runID
	entry.pendingEcho = replay.pendingEcho
	entry.attached = replay.attached
	entry.replay = nil
	entry.state.Unlock()
	m.scheduleFollowUp(sessionID, entry)
	return nil
}

func (m *SessionManager) List(ctx context.Context, projectID string, archived any) ([]SessionSummary, error) {
	records, err := m.records.List()
	if err != nil {
		return nil, err
	}
	filtered := records[:0]
	for _, record := range records {
		if record.ProjectID == projectID {
			filtered = append(filtered, record)
		}
	}
	remote := make(map[string]remoteSession)
	var cursor *string
	seen := make(map[string]bool)
	for page := 0; page < 20; page++ {
		response, err := m.client.ListSessions(ctx, acp.ListSessionsRequest{Cursor: cursor})
		if err != nil {
			return nil, err
		}
		for _, session := range response.Sessions {
			remote[string(session.SessionId)] = normalizeRemoteSession(session)
		}
		if response.NextCursor == nil {
			break
		}
		if seen[*response.NextCursor] {
			return nil, fmt.Errorf("Goose session list was truncated because it repeated a cursor")
		}
		seen[*response.NextCursor] = true
		cursor = response.NextCursor
		if page == 19 {
			return nil, fmt.Errorf("Goose session list was truncated after 20 pages")
		}
	}
	missing := make([]ProjectSessionRecord, 0)
	for _, record := range filtered {
		if _, found := remote[record.SessionID]; !found {
			missing = append(missing, record)
		}
	}
	if len(missing) > 200 {
		return nil, fmt.Errorf("Goose session list requires more than 200 per-session lookups")
	}
	for _, record := range missing {
		info, err := m.info(ctx, record.SessionID)
		if err != nil {
			var requestError *acp.RequestError
			if errors.As(err, &requestError) && requestError.Code == -32002 {
				continue
			}
			return nil, err
		}
		remote[record.SessionID] = info
	}
	result := make([]SessionSummary, 0, len(filtered))
	for _, record := range filtered {
		source, found := remote[record.SessionID]
		if !found {
			continue
		}
		wantArchived := archived == true || archived == "all"
		wantActive := archived != true
		if source.archived && !wantArchived || !source.archived && !wantActive {
			continue
		}
		m.mu.Lock()
		live := m.sessions[record.SessionID]
		m.mu.Unlock()
		if live != nil && !source.archived {
			result = append(result, m.summary(record.SessionID, live))
			continue
		}
		result = append(result, SessionSummary{SessionID: record.SessionID, ProjectID: projectID, CWD: record.CWD, ParentSessionID: record.ParentSessionID, Title: source.title, ThinkingLevel: "off", MessageCount: source.messageCount, UpdatedAt: source.updatedAt, Live: false, Archived: source.archived})
	}
	return result, nil
}

func (m *SessionManager) Messages(ctx context.Context, sessionID, projectID, cwd, clientKey string) (map[string]any, error) {
	entry, err := m.EnsureAttached(ctx, sessionID, projectID, cwd)
	if err != nil {
		return nil, err
	}
	defer m.releaseEntry(entry)
	m.mu.Lock()
	m.retainSessionLocked(clientKey, sessionID, projectID)
	m.mu.Unlock()
	entry.state.Lock()
	messages, encodeErr := json.Marshal(entry.messages)
	entry.state.Unlock()
	if encodeErr != nil {
		return nil, encodeErr
	}
	summary := m.summary(sessionID, entry)
	return map[string]any{"summary": summary, "messages": json.RawMessage(messages)}, nil
}

func (m *SessionManager) SetModel(ctx context.Context, sessionID string, model WireModel) error {
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
	ctx = entry.context(ctx)
	entry.state.Lock()
	current := entry.model
	entry.state.Unlock()
	if current != nil && current.Provider == model.Provider && current.ID == model.ID {
		return nil
	}
	if current == nil || current.Provider != model.Provider {
		options, err := m.setConfig(ctx, sessionID, "provider", model.Provider)
		if err != nil {
			return err
		}
		entry.state.Lock()
		entry.configOptions = options
		entry.state.Unlock()
	}
	options, err := m.setConfig(ctx, sessionID, "model", model.ID)
	if err != nil {
		return err
	}
	entry.state.Lock()
	entry.configOptions = options
	entry.model = &model
	entry.state.Unlock()
	return nil
}

func (m *SessionManager) SetThinking(ctx context.Context, sessionID, level string) error {
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
	options, err := m.setConfig(entry.context(ctx), sessionID, "thinking_effort", level)
	if err != nil {
		return err
	}
	entry.state.Lock()
	entry.configOptions = options
	entry.thinkingLevel = level
	entry.state.Unlock()
	return nil
}

func (m *SessionManager) setConfig(ctx context.Context, sessionID, configID, value string) ([]any, error) {
	response, err := m.client.SetConfig(ctx, acp.SetSessionConfigOptionRequest{ValueId: &acp.SetSessionConfigOptionValueId{SessionId: acp.SessionId(sessionID), ConfigId: acp.SessionConfigId(configID), Value: acp.SessionConfigValueId(value)}})
	if err != nil {
		return nil, err
	}
	return jsonValues(response.ConfigOptions), nil
}

func (m *SessionManager) entry(sessionID string) (*sessionEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.lifecycle[sessionID] {
		return nil, fmt.Errorf("wait for the chat lifecycle operation to finish")
	}
	entry := m.sessions[sessionID]
	if entry == nil {
		return nil, fmt.Errorf("unknown session: %s", sessionID)
	}
	entry.refs++
	return entry, nil
}

func (m *SessionManager) releaseEntry(entry *sessionEntry) {
	m.mu.Lock()
	entry.state.Lock()
	entry.inactiveBytes = 0
	entry.state.Unlock()
	entry.refs--
	m.evictLocked()
	m.mu.Unlock()
}

func (m *SessionManager) retainSessionLocked(clientKey, sessionID, projectID string) {
	if m.leases == nil {
		m.leases = make(map[string]*clientSessionLeases)
	}
	leases := m.leases[clientKey]
	if leases == nil {
		leases = &clientSessionLeases{sessions: make(map[string]string)}
		m.leases[clientKey] = leases
	}
	// Older browsers acquire implicitly. Once a browser declares its open tabs,
	// a late create/load response must not resurrect a tab it already closed.
	if leases.revision == 0 {
		leases.sessions[sessionID] = projectID
	}
}

func (m *SessionManager) SetLeases(clientKey string, revision uint64, requested []sessionLease) error {
	if revision == 0 || revision > 1<<53-1 || len(requested) > 512 {
		return fmt.Errorf("invalid session lease snapshot")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return fmt.Errorf("session manager has been shut down")
	}
	if previous := m.leases[clientKey]; previous != nil && revision <= previous.revision {
		return nil
	}
	// Read after acquiring mu: a completed delete must not be resurrected from
	// an association captured before its lifecycle operation finished.
	records, err := m.records.List()
	if err != nil {
		return err
	}
	byID := make(map[string]ProjectSessionRecord, len(records))
	for _, record := range records {
		byID[record.SessionID] = record
	}
	next := &clientSessionLeases{revision: revision, sessions: make(map[string]string, len(requested))}
	projects := make(map[string]Project)
	directories := make(map[string]string)
	for _, lease := range requested {
		if lease.ProjectID == "" || lease.SessionID == "" {
			return fmt.Errorf("invalid session lease snapshot")
		}
		record, ok := byID[lease.SessionID]
		if !ok {
			// Another browser may have deleted this tab while we were offline.
			// Ignore it without preventing the remaining tabs from reacquiring.
			continue
		}
		if record.ProjectID != lease.ProjectID {
			return fmt.Errorf("unknown session: %s", lease.SessionID)
		}
		project, found := projects[lease.ProjectID]
		if !found {
			project, err = m.projects.Get(lease.ProjectID)
			if err != nil {
				return err
			}
			projects[lease.ProjectID] = project
		}
		// Closing a project is global. Check under the same lock as ReleaseProject
		// so an older in-flight snapshot cannot restore its abandoned leases.
		if project.Closed {
			continue
		}
		cwd, checked := directories[record.CWD]
		if !checked {
			cwd, err = m.policy.Directory(record.CWD, "Session directory")
			if err != nil {
				return err
			}
			directories[record.CWD] = cwd
		}
		admitted := false
		for _, root := range project.Roots {
			admitted = admitted || within(root, cwd)
		}
		if !admitted {
			return fmt.Errorf("session directory is outside the project roots")
		}
		next.sessions[lease.SessionID] = lease.ProjectID
	}
	if m.leases == nil {
		m.leases = make(map[string]*clientSessionLeases)
	}
	m.leases[clientKey] = next
	for sessionID, projectID := range next.sessions {
		if m.sessions[sessionID] == nil && !m.lifecycle[sessionID] {
			record := byID[sessionID]
			// A long disconnect may outlive eviction. Restore only the association;
			// the next read/prompt loads the authoritative transcript from Goose.
			m.sessions[sessionID] = newSessionEntry(sessionID, projectID, record.CWD, record.ParentSessionID, randomID())
		}
	}
	m.evictLocked()
	return nil
}

func (m *SessionManager) Release(sessionID, projectID, cwd, clientKey string) {
	m.mu.Lock()
	entry := m.sessions[sessionID]
	leases := m.leases[clientKey]
	if leases != nil && leases.sessions[sessionID] == projectID && (entry == nil || entry.projectID == projectID && entry.cwd == cwd) {
		delete(leases.sessions, sessionID)
	}
	m.evictLocked()
	m.mu.Unlock()
}

func (m *SessionManager) isLeasedLocked(sessionID string) bool {
	for _, client := range m.leases {
		if _, found := client.sessions[sessionID]; found {
			return true
		}
	}
	return false
}

func (m *SessionManager) ReleaseClient(clientKey string) {
	m.mu.Lock()
	delete(m.leases, clientKey)
	m.evictLocked()
	m.mu.Unlock()
}

func (m *SessionManager) ReleaseProject(projectID string) {
	m.mu.Lock()
	// Close publishes before this cleanup runs. Another browser can already have
	// reopened the project and acquired a newer snapshot in that interval.
	if project, err := m.projects.Get(projectID); err == nil && !project.Closed {
		m.mu.Unlock()
		return
	}
	for _, leases := range m.leases {
		for sessionID, owner := range leases.sessions {
			if owner == projectID {
				delete(leases.sessions, sessionID)
			}
		}
	}
	m.evictLocked()
	m.mu.Unlock()
}

func (m *SessionManager) summary(sessionID string, entry *sessionEntry) SessionSummary {
	entry.state.Lock()
	defer entry.state.Unlock()
	queue := SessionQueue{Revision: entry.queue.Revision, Steering: append([]string{}, entry.queue.Steering...), FollowUp: append([]string{}, entry.queue.FollowUp...)}
	return SessionSummary{SessionID: sessionID, ProjectID: entry.projectID, CWD: entry.cwd, ParentSessionID: entry.parentSessionID, Title: entry.title, Model: entry.model, ThinkingLevel: entry.thinkingLevel, IsStreaming: entry.streaming, MessageCount: len(entry.messages), UpdatedAt: m.now().UnixMilli(), Live: true, Archived: false, LastSettlement: entry.settlement, Queue: &queue}
}

func (m *SessionManager) evictLocked() {
	type candidate struct {
		id    string
		at    time.Time
		bytes int
	}
	var candidates []candidate
	total := 0
	leased := make(map[string]bool)
	for _, client := range m.leases {
		for sessionID := range client.sessions {
			leased[sessionID] = true
		}
	}
	for id, entry := range m.sessions {
		if entry.refs > 0 {
			continue
		}
		entry.state.Lock()
		if leased[id] || entry.streaming || entry.runID != "" || len(entry.queue.Steering) > 0 || len(entry.queue.FollowUp) > 0 || entry.replay != nil {
			entry.inactiveAt = time.Time{}
			entry.state.Unlock()
			continue
		}
		if entry.ephemeral {
			delete(m.sessions, id)
			entry.state.Unlock()
			continue
		}
		if entry.inactiveAt.IsZero() {
			entry.inactiveAt = m.now()
		}
		if entry.inactiveBytes == 0 {
			encoded, err := json.Marshal(entry.messages)
			if err != nil {
				// A projection that cannot be measured must not bypass the budget.
				delete(m.sessions, id)
				entry.state.Unlock()
				continue
			}
			entry.inactiveBytes = len(encoded)
		}
		candidates = append(candidates, candidate{id: id, at: entry.inactiveAt, bytes: entry.inactiveBytes})
		total += entry.inactiveBytes
		entry.state.Unlock()
	}
	for len(candidates) > inactiveProjectionMaxCount || total > inactiveProjectionMaxBytes {
		oldest := 0
		for index := range candidates {
			if candidates[index].at.Before(candidates[oldest].at) {
				oldest = index
			}
		}
		item := candidates[oldest]
		delete(m.sessions, item.id)
		total -= item.bytes
		candidates = append(candidates[:oldest], candidates[oldest+1:]...)
	}
}

func newSessionEntry(sessionID, projectID, cwd, parent, token string) *sessionEntry {
	return &sessionEntry{projectID: projectID, cwd: cwd, parentSessionID: parent, title: "Chat", thinkingLevel: "off", messages: []any{}, stats: SessionStats{SessionID: sessionID, Reported: map[string]bool{}}, queue: SessionQueue{Revision: randomID(), Steering: []string{}, FollowUp: []string{}}, objectiveToken: token, consumedQuestions: make(map[string]bool)}
}

func (m *SessionManager) objectiveServers(token string) []acp.McpServer {
	if m.objectiveURL == "" {
		return []acp.McpServer{}
	}
	return []acp.McpServer{{Http: &acp.McpServerHttpInline{Type: "http", Name: "gooseberry_objectives", Url: m.objectiveURL, Headers: []acp.HttpHeader{{Name: "Authorization", Value: "Bearer " + token}}}}}
}

type remoteSession struct {
	title        string
	updatedAt    int64
	messageCount int
	archived     bool
}

func normalizeRemoteSession(session acp.SessionInfo) remoteSession {
	title := "Chat"
	if session.Title != nil && *session.Title != "" {
		title = *session.Title
	}
	updated := time.Now().UnixMilli()
	if session.UpdatedAt != nil {
		if parsed, err := time.Parse(time.RFC3339Nano, *session.UpdatedAt); err == nil {
			updated = parsed.UnixMilli()
		}
	}
	archived := false
	messageCount := 0
	if value, ok := session.Meta["archivedAt"]; ok && value != nil {
		archived = true
	}
	if value, ok := numeric(session.Meta["messageCount"]); ok {
		messageCount = int(value)
	}
	return remoteSession{title: title, updatedAt: updated, messageCount: messageCount, archived: archived}
}

func jsonValues[T any](values []T) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		encoded, _ := json.Marshal(value)
		var decoded any
		_ = json.Unmarshal(encoded, &decoded)
		result = append(result, decoded)
	}
	return result
}

func thinkingFromOptions(options []any) string {
	for _, value := range options {
		option, _ := value.(map[string]any)
		if option["id"] == "thinking_effort" {
			if current, ok := option["currentValue"].(string); ok {
				return current
			}
		}
	}
	return "off"
}

func modelFromSetup(options []any, meta map[string]any) *WireModel {
	goose, _ := meta["goose"].(map[string]any)
	provider, _ := firstString(meta["providerId"], goose["providerId"])
	model, _ := firstString(meta["modelId"], goose["modelId"])
	for _, raw := range options {
		option := mapValue(raw)
		value, ok := option["currentValue"].(string)
		if !ok {
			continue
		}
		switch option["id"] {
		case "provider":
			provider = value
		case "model":
			model = value
		}
	}
	if provider == "" || model == "" {
		return nil
	}
	return &WireModel{ID: model, Name: model, Provider: provider, Available: true}
}

func firstString(values ...any) (string, bool) {
	for _, value := range values {
		if text, ok := value.(string); ok && text != "" {
			return text, true
		}
	}
	return "", false
}

func numeric(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || math.Trunc(typed) != typed || typed < math.MinInt64 || typed >= math.MaxInt64 {
			return 0, false
		}
		return int64(typed), true
	case int:
		return int64(typed), true
	case json.Number:
		parsed, err := strconv.ParseInt(string(typed), 10, 64)
		return parsed, err == nil
	}
	return 0, false
}

func nonempty(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsRune(value, 0) {
		return "", fmt.Errorf("value cannot be empty")
	}
	return value, nil
}
