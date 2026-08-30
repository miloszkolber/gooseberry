package controller

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultControllerPort = 7312
	DefaultDataDir        = "/var/lib/gooseberry"
	DefaultStaticDir      = "/app/web"
)

type RuntimeConfig struct {
	Host       string
	Port       int
	DataDir    string
	StaticDir  string
	AppVersion string
	// Optional embedding/test endpoint; the production entrypoint uses pinned host Goose.
	GooseURL string
	Policy   *PathPolicy
	Getenv   func(string) string
}

type Runtime struct {
	config   RuntimeConfig
	auth     AuthConfig
	server   *http.Server
	listener net.Listener
	client   *GooseClient
	sessions *SessionManager
	socket   *WebSocketServer
	logins   *ProviderLogins
	watches  *ProjectWatches
	errors   chan error
}

func NewRuntime(config RuntimeConfig) (*Runtime, error) {
	if config.Getenv == nil {
		config.Getenv = os.Getenv
	}
	authConfig, err := ReadAuthConfig(config.Getenv)
	if err != nil {
		return nil, err
	}
	if config.Host == "" {
		config.Host = authConfig.ControllerHost
	}
	if config.Port == 0 {
		config.Port = DefaultControllerPort
	}
	if config.DataDir == "" {
		config.DataDir = DefaultDataDir
	}
	if config.StaticDir == "" {
		config.StaticDir = DefaultStaticDir
	}
	if config.Policy == nil {
		config.Policy, err = DiscoverPathPolicy()
		if err != nil {
			return nil, fmt.Errorf("discover project mounts: %w", err)
		}
	}
	store := Store{Dir: config.DataDir}
	projects := NewProjects(store, config.Policy)
	files := NewFiles(projects, config.Policy)
	var socket *WebSocketServer
	publish := func(channel string, data any) {
		if socket != nil {
			_ = socket.Publish(context.Background(), channel, data)
		}
	}
	projects.publish = func(project Project) { publish("project.updated", project) }
	settings := NewSettings(store, func(value AppConfig) { publish("settings.changed", value) })
	sessions := NewSessionManager(projects, config.Policy, NewSessionRecords(store), NewObjectives(store), publish)
	client := NewGooseClient(config.GooseURL, strings.TrimSpace(config.Getenv("GOOSEBERRY_GOOSE_SECRET_KEY")), config.AppVersion, sessions)
	sessions.SetClient(client)
	sessions.SetObjectiveURL("http://127.0.0.1:" + strconv.Itoa(config.Port) + "/mcp/objective")
	admin := NewGooseAdmin(client, settings)
	admin.sessions = sessions
	admin.logins.publish = func(clientKey string, data any) {
		if socket != nil {
			_ = socket.PublishToClient(context.Background(), clientKey, "provider.login", data)
		}
	}
	sessions.deviceCode = admin.logins.DeviceCode
	git := NewGit(projects, config.Policy)
	watches := NewProjectWatches(projects, git, publish)
	handler := CoreHandler{Projects: projects, Files: files, Sessions: sessions, Settings: settings, Admin: admin, Git: git, Watches: watches}
	welcome := func(context.Context) (any, error) {
		open, err := projects.List(false)
		if err != nil {
			return nil, err
		}
		recent, err := projects.List(true)
		if err != nil {
			return nil, err
		}
		appConfig, err := settings.Get()
		if err != nil {
			return nil, err
		}
		result := map[string]any{"protocolVersion": BrowserProtocolVersion, "projects": open, "recentProjects": recent, "config": appConfig, "gooseStatus": runtimeGooseStatus(context.Background(), client), "pendingPermissions": sessions.PendingPermissions()}
		if config.AppVersion != "" {
			result["appVersion"] = config.AppVersion
		}
		return result, nil
	}
	socket, err = NewWebSocketServer(handler, welcome, authConfig)
	if err != nil {
		return nil, err
	}
	socket.LoginSnapshot = admin.logins.Snapshot
	ready := func(response http.ResponseWriter, request *http.Request) {
		status := runtimeGooseStatus(request.Context(), client)
		code := http.StatusOK
		if status["configured"] != true || status["reachable"] != true {
			code = http.StatusServiceUnavailable
		}
		writeAuthJSON(response, code, status)
	}
	httpHandler, err := NewHTTPHandler(socket, ObjectiveHandler{Sessions: sessions}, projects, files, authConfig, config.StaticDir, ready)
	if err != nil {
		return nil, err
	}
	return &Runtime{config: config, auth: authConfig, server: &http.Server{Handler: httpHandler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}, client: client, sessions: sessions, socket: socket, logins: admin.logins, watches: watches}, nil
}

func (r *Runtime) Start() (string, error) {
	listener, err := net.Listen("tcp", net.JoinHostPort(r.config.Host, strconv.Itoa(r.config.Port)))
	if err != nil {
		return "", err
	}
	r.listener = listener
	r.errors = make(chan error, 1)
	go func() { r.errors <- r.server.Serve(listener) }()
	return "http://" + net.JoinHostPort(r.config.Host, strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)), nil
}

func (r *Runtime) Errors() <-chan error { return r.errors }

func (r *Runtime) Shutdown(ctx context.Context) error {
	r.logins.Close()
	r.watches.Close()
	r.sessions.cancelAll(ctx)
	r.socket.Close()
	r.client.Close()
	return r.server.Shutdown(ctx)
}

func runtimeGooseStatus(ctx context.Context, client *GooseClient) map[string]any {
	if client.SecretKey == "" {
		return map[string]any{"configured": false, "reachable": false, "error": "GOOSEBERRY_GOOSE_SECRET_KEY is not configured"}
	}
	bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if _, err := client.Ready(bounded); err != nil {
		return map[string]any{"configured": true, "reachable": false, "error": err.Error()}
	}
	return map[string]any{"configured": true, "reachable": true}
}

func (m *SessionManager) cancelAll(ctx context.Context) {
	m.mu.Lock()
	m.closed = true
	active := make(map[string]uint64)
	ids := make([]string, 0, len(m.sessions))
	for id, entry := range m.sessions {
		ids = append(ids, id)
		entry.state.Lock()
		if entry.streaming || entry.runID != "" {
			active[id] = entry.attached
		}
		entry.promptGeneration++
		entry.queue = SessionQueue{Steering: []string{}, FollowUp: []string{}}
		entry.state.Unlock()
	}
	questions := m.questions
	m.questions = make(map[string]*pendingQuestion)
	m.mu.Unlock()
	for _, id := range ids {
		m.cancelPermissions(id)
	}
	for _, pending := range questions {
		select {
		case pending.result <- map[string]any{"answers": []any{}, "cancelled": true}:
		default:
		}
	}
	var pending sync.WaitGroup
	for id, generation := range active {
		pending.Add(1)
		go func(sessionID string) {
			defer pending.Done()
			_ = m.client.Cancel(context.WithValue(ctx, connectionGenerationKey{}, generation), sessionID)
		}(id)
	}
	pending.Wait()
}
