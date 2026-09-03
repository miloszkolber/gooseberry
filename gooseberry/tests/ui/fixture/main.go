package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
	controller "github.com/miloszkolber/gooseberry/internal/controller"
	"github.com/miloszkolber/gooseberry/internal/persist"
	"github.com/miloszkolber/gooseberry/internal/workspace"
)

const (
	projectID = "fixture-project"
	sessionID = "fixture-1"
	readyFile = "/tmp/gooseberry-ui-ready"
)

type fixtureAgent struct {
	release     chan struct{}
	releaseOnce sync.Once
	modeMu      sync.Mutex
	mode        string
}

type rpcWriter struct {
	connection *websocket.Conn
	mu         sync.Mutex
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	_ = os.Remove(readyFile)
	root := "/tmp/gooseberry-ui/project"
	data := "/tmp/gooseberry-ui/state"
	if err := seedProject(root, data); err != nil {
		return err
	}
	policy, err := workspace.NewPathPolicy([]string{root}, false)
	if err != nil {
		return err
	}
	agent := &fixtureAgent{release: make(chan struct{}), mode: "ask"}
	agentServer, agentURL, err := agent.start()
	if err != nil {
		return err
	}
	port := 7312
	if configured := os.Getenv("GOOSEBERRY_UI_FIXTURE_PORT"); configured != "" {
		parsed, parseErr := strconv.Atoi(configured)
		if parseErr != nil || parsed < 1024 || parsed > 65535 {
			return fmt.Errorf("invalid GOOSEBERRY_UI_FIXTURE_PORT")
		}
		port = parsed
	}
	runtime, err := controller.NewRuntime(controller.RuntimeConfig{
		Host:       "127.0.0.1",
		Port:       port,
		DataDir:    data,
		StaticDir:  "/app/web",
		AppVersion: "ui-acceptance",
		GooseURL:   agentURL,
		Policy:     policy,
		Getenv:     os.Getenv,
	})
	if err != nil {
		_ = agentServer.Close()
		return err
	}
	endpoint, err := runtime.Start()
	if err != nil {
		_ = agentServer.Close()
		return err
	}
	if err := os.WriteFile(readyFile, []byte(endpoint+"\n"), 0o600); err != nil {
		_ = agentServer.Close()
		return err
	}
	fmt.Printf("UI fixture ready at %s\n", endpoint)

	signals := make(chan os.Signal, 2)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGUSR1)
	defer signal.Stop(signals)
	for {
		select {
		case received := <-signals:
			if received == syscall.SIGUSR1 {
				agent.releaseOnce.Do(func() { close(agent.release) })
				continue
			}
			return shutdown(runtime, agentServer)
		case serveErr := <-runtime.Errors():
			if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
				return serveErr
			}
			return nil
		}
	}
}

func shutdown(runtime *controller.Runtime, agent *http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return errors.Join(runtime.Shutdown(ctx), agent.Shutdown(ctx))
}

func seedProject(root, data string) error {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(data, 0o700); err != nil {
		return err
	}
	files := map[string][]byte{
		"README.md":   []byte("# UI acceptance\n\nWelcome to acceptance.\n"),
		"dirty.go":    []byte("package fixture\n\nconst Current = \"dirty working tree\"\n"),
		"fixture.png": fixturePNG(),
		"history.txt": []byte("before\n"),
	}
	for name, contents := range files {
		if err := os.WriteFile(filepath.Join(root, name), contents, 0o600); err != nil {
			return err
		}
	}
	if err := git(root, nil, "init", "-b", "main"); err != nil {
		return err
	}
	if err := git(root, nil, "config", "user.email", "fixture@gooseberry.invalid"); err != nil {
		return err
	}
	if err := git(root, nil, "config", "user.name", "Gooseberry fixture"); err != nil {
		return err
	}
	if err := git(root, nil, "add", "."); err != nil {
		return err
	}
	firstDate := []string{"GIT_AUTHOR_DATE=2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE=2026-01-01T00:00:00Z"}
	if err := git(root, firstDate, "commit", "-m", "Add fixture"); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "history.txt"), []byte("after\n"), 0o600); err != nil {
		return err
	}
	if err := git(root, nil, "add", "history.txt"); err != nil {
		return err
	}
	secondDate := []string{"GIT_AUTHOR_DATE=2026-01-02T00:00:00Z", "GIT_COMMITTER_DATE=2026-01-02T00:00:00Z"}
	if err := git(root, secondDate, "commit", "-m", "Change fixture"); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "dirty.go"), []byte("package fixture\n\nconst Current = \"uncommitted change\"\n"), 0o600); err != nil {
		return err
	}
	projects := []workspace.Project{{
		ID: projectID, Name: "Fixture", Roots: []string{root}, Slug: "fixture", LastOpened: 1,
	}}
	encoded, err := json.MarshalIndent(projects, "", "\t")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(data, "projects.json"), append(encoded, '\n'), 0o600); err != nil {
		return err
	}
	records := controller.NewSessionRecords(persist.Store{Dir: data})
	return records.Record(controller.ProjectSessionRecord{ProjectID: projectID, SessionID: sessionID, CWD: root})
}

func git(directory string, extraEnvironment []string, arguments ...string) error {
	command := exec.Command("git", arguments...)
	command.Dir = directory
	command.Env = append(os.Environ(), extraEnvironment...)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %s: %w: %s", strings.Join(arguments, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func fixturePNG() []byte {
	canvas := image.NewRGBA(image.Rect(0, 0, 160, 96))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.RGBA{R: 246, G: 247, B: 244, A: 255}), image.Point{}, draw.Src)
	draw.Draw(canvas, image.Rect(76, 8, 84, 28), image.NewUniform(color.RGBA{R: 39, G: 92, B: 45, A: 255}), image.Point{}, draw.Src)
	for y := 16; y < 90; y++ {
		for x := 42; x < 118; x++ {
			dx, dy := x-80, y-54
			if dx*dx+dy*dy > 36*36 {
				continue
			}
			shade := color.RGBA{R: 106, G: 166, B: 91, A: 255}
			if y > 60 {
				shade = color.RGBA{R: 73, G: 135, B: 69, A: 255}
			}
			if hx, hy := x-67, y-40; hx*hx+hy*hy < 7*7 {
				shade = color.RGBA{R: 220, G: 238, B: 211, A: 255}
			}
			canvas.SetRGBA(x, y, shade)
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, canvas); err != nil {
		panic(err)
	}
	return encoded.Bytes()
}

func (a *fixtureAgent) start() (*http.Server, string, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, "", err
	}
	server := &http.Server{Handler: http.HandlerFunc(a.serveHTTP), ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.Serve(listener) }()
	return server, "ws://" + listener.Addr().String() + "/acp", nil
}

func (a *fixtureAgent) serveHTTP(response http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/acp" {
		http.NotFound(response, request)
		return
	}
	connection, err := websocket.Accept(response, request, nil)
	if err != nil {
		return
	}
	defer connection.CloseNow()
	writer := &rpcWriter{connection: connection}
	for {
		_, payload, err := connection.Read(request.Context())
		if err != nil {
			return
		}
		var rpc struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params map[string]any  `json:"params"`
		}
		if json.Unmarshal(payload, &rpc) != nil {
			return
		}
		result := any(map[string]any{})
		switch rpc.Method {
		case "initialize":
			result = map[string]any{
				"protocolVersion": 1,
				"agentInfo":       map[string]any{"name": "fixture-agent", "version": "1.0.0"},
				"agentCapabilities": map[string]any{
					"loadSession":         true,
					"promptCapabilities":  map[string]any{"image": true},
					"sessionCapabilities": map[string]any{"list": map[string]any{}},
				},
				"authMethods": []any{},
			}
		case "session/list":
			result = map[string]any{"sessions": []any{map[string]any{
				"sessionId": sessionID,
				"cwd":       "/tmp/gooseberry-ui/project",
				"title":     "Fixture chat",
				"updatedAt": "2026-01-02T00:00:00Z",
			}}}
		case "session/new":
			result = map[string]any{"sessionId": "new-fixture", "modes": a.sessionModes()}
		case "session/load":
			id, _ := rpc.Params["sessionId"].(string)
			if id == "" {
				id = sessionID
			}
			for _, update := range []map[string]any{
				{"sessionUpdate": "plan", "entries": []any{
					map[string]any{"content": "Inspect the workspace", "priority": "high", "status": "completed"},
					map[string]any{"content": "Finish the reply", "priority": "medium", "status": "in_progress"},
				}},
				{"sessionUpdate": "user_message_chunk", "content": map[string]any{"type": "image", "data": base64.StdEncoding.EncodeToString(fixturePNG()), "mimeType": "image/png"}},
				{"sessionUpdate": "user_message_chunk", "content": map[string]any{"type": "text", "text": "Show the fixture"}},
				{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "Loaded answer"}},
			} {
				if writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": id, "update": update}}) != nil {
					return
				}
			}
			result = map[string]any{"modes": a.sessionModes()}
		case "session/prompt":
			id, _ := rpc.Params["sessionId"].(string)
			if id == "" {
				id = sessionID
			}
			if writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": id, "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "Partial reply "}}}}) != nil {
				return
			}
			responseID := append(json.RawMessage(nil), rpc.ID...)
			go func() {
				select {
				case <-a.release:
				case <-request.Context().Done():
					return
				}
				if writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": id, "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "complete."}}}}) != nil {
					return
				}
				_ = writer.write(map[string]any{"jsonrpc": "2.0", "id": responseID, "result": map[string]any{"stopReason": "end_turn"}})
			}()
			continue
		case "session/set_mode":
			id, _ := rpc.Params["sessionId"].(string)
			modeID, _ := rpc.Params["modeId"].(string)
			if id == "" {
				id = sessionID
			}
			if !a.setMode(modeID) {
				if len(rpc.ID) > 0 {
					_ = writer.write(map[string]any{
						"jsonrpc": "2.0",
						"id":      rpc.ID,
						"error":   map[string]any{"code": -32602, "message": "unknown fixture mode"},
					})
				}
				continue
			}
			if writer.write(map[string]any{
				"jsonrpc": "2.0",
				"method":  "session/update",
				"params": map[string]any{
					"sessionId": id,
					"update": map[string]any{
						"sessionUpdate": "current_mode_update",
						"currentModeId": modeID,
					},
				},
			}); err != nil {
				return
			}
		case "session/cancel":
			a.releaseOnce.Do(func() { close(a.release) })
		}
		if len(rpc.ID) > 0 && writer.write(map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
			return
		}
	}
}

func (a *fixtureAgent) sessionModes() map[string]any {
	a.modeMu.Lock()
	defer a.modeMu.Unlock()
	return map[string]any{
		"currentModeId": a.mode,
		"availableModes": []any{
			map[string]any{"id": "ask", "name": "Ask", "description": "Discuss before changing files"},
			map[string]any{"id": "code", "name": "Code", "description": "Work directly in the project"},
		},
	}
}

func (a *fixtureAgent) setMode(modeID string) bool {
	if modeID != "ask" && modeID != "code" {
		return false
	}
	a.modeMu.Lock()
	a.mode = modeID
	a.modeMu.Unlock()
	return true
}

func (w *rpcWriter) write(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.connection.Write(context.Background(), websocket.MessageText, payload)
}
