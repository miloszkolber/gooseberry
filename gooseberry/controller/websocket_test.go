package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type countingHandler struct {
	inner Handler
	calls atomic.Int32
}

func (h *countingHandler) Handle(ctx context.Context, method string, params json.RawMessage, client string) (any, error) {
	h.calls.Add(1)
	return h.inner.Handle(ctx, method, params, client)
}

func TestBrowserWireCoreRoundTripAndReplay(t *testing.T) {
	mount := t.TempDir()
	policy, err := NewPathPolicy([]string{mount}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := NewProjects(Store{Dir: t.TempDir()}, policy)
	files := NewFiles(projects, policy)
	handler := &countingHandler{inner: CoreHandler{Projects: projects, Files: files}}
	server, err := NewWebSocketServer(handler, func(context.Context) (any, error) {
		return map[string]any{"protocolVersion": BrowserProtocolVersion, "projects": []Project{}, "recentProjects": []Project{}, "config": map[string]any{}, "pendingPermissions": []any{}}, nil
	}, AuthConfig{})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	url := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/?client=stable"
	connection, _, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPHeader: map[string][]string{"Origin": {httpServer.URL}}})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	_, welcome, err := connection.Read(context.Background())
	if err != nil || !strings.Contains(string(welcome), `"protocolVersion":67`) {
		t.Fatalf("welcome %s, %v", welcome, err)
	}
	request := []byte(`{"id":"one","method":"project.open","params":{"path":` + mustJSON(t, mount) + `}}`)
	for attempt := 0; attempt < 2; attempt++ {
		if err := connection.Write(context.Background(), websocket.MessageText, request); err != nil {
			t.Fatal(err)
		}
		_, response, err := connection.Read(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		var parsed struct {
			OK     bool    `json:"ok"`
			Result Project `json:"result"`
		}
		if err := json.Unmarshal(response, &parsed); err != nil || !parsed.OK || parsed.Result.ID == "" {
			t.Fatalf("response %s, %v", response, err)
		}
		if attempt == 0 {
			// The retry is a new transport connection, not just a repeated frame.
			connection.CloseNow()
			connection, _, err = websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPHeader: map[string][]string{"Origin": {httpServer.URL}}})
			if err != nil {
				t.Fatal(err)
			}
			defer connection.CloseNow()
			if _, _, err := connection.Read(context.Background()); err != nil {
				t.Fatal(err)
			}
			request = []byte(`{"id":"one","method":"project.open","params":{"path":` + mustJSON(t, mount) + `}}`)
		}
	}
	list, err := projects.List(true)
	if err != nil || len(list) != 1 {
		t.Fatalf("replay executed mutation twice: %#v, %v", list, err)
	}
	if handler.calls.Load() != 1 {
		t.Fatalf("request executed %d times", handler.calls.Load())
	}
	// Malformed envelopes must not acknowledge a valid replay entry.
	for _, malformed := range []string{`{"ack":["one"],"method":"project.open"}`, `{"resume":[1]}`, `{"method":"project.open","id":5}`} {
		if err := connection.Write(context.Background(), websocket.MessageText, []byte(malformed)); err != nil {
			t.Fatal(err)
		}
	}
	if err := connection.Write(context.Background(), websocket.MessageText, request); err != nil {
		t.Fatal(err)
	}
	if _, _, err := connection.Read(context.Background()); err != nil {
		t.Fatal(err)
	}
	if handler.calls.Load() != 1 {
		t.Fatal("malformed frame invalidated replay")
	}
	// Sending a large escaped response must not mutate the retained replay bytes.
	content := strings.Repeat("quoted \"text\"\\\nżółw\n", 32*1024)
	if err := os.WriteFile(filepath.Join(mount, "replay.txt"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	fileRequest := []byte(`{"id":"file","method":"fs.readFile","params":{"projectId":` + mustJSON(t, list[0].ID) + `,"root":` + mustJSON(t, mount) + `,"path":"replay.txt"}}`)
	connection.SetReadLimit(4 * 1024 * 1024)
	var first []byte
	for attempt := range 2 {
		if err := connection.Write(context.Background(), websocket.MessageText, fileRequest); err != nil {
			t.Fatal(err)
		}
		_, response, err := connection.Read(context.Background())
		var parsed struct {
			OK     bool `json:"ok"`
			Result struct {
				Content string `json:"content"`
			} `json:"result"`
		}
		if err != nil || json.Unmarshal(response, &parsed) != nil || !parsed.OK || parsed.Result.Content != content {
			t.Fatalf("large file response changed: attempt=%d, bytes=%d, error=%v", attempt, len(response), err)
		}
		if attempt == 0 {
			first = response
		} else if !bytes.Equal(first, response) {
			t.Fatal("replayed file response differs from first delivery")
		}
	}
	if handler.calls.Load() != 2 {
		t.Fatal("file response executed again instead of replaying")
	}
	// Excess duplicate waiters are bounded too; the existing response survives.
	for range cap(server.inflight) {
		server.inflight <- struct{}{}
	}
	if err := connection.Write(context.Background(), websocket.MessageText, request); err != nil {
		t.Fatal(err)
	}
	if _, _, err := connection.Read(context.Background()); websocket.CloseStatus(err) != websocket.StatusTryAgainLater {
		t.Fatalf("overload close: %v", err)
	}
	for range cap(server.inflight) {
		<-server.inflight
	}
}

func mustJSON(t *testing.T, value string) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func TestSlowBrowserCannotStallOrderedUpdatesOrRequestReplay(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	server, err := NewWebSocketServer(CoreHandler{}, func(context.Context) (any, error) {
		return map[string]any{"protocolVersion": BrowserProtocolVersion}, nil
	}, AuthConfig{})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	host := httptest.NewServer(server)
	defer host.Close()
	connect := func(key string) *websocket.Conn {
		t.Helper()
		connection, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(host.URL, "http")+"/?client="+key, &websocket.DialOptions{HTTPHeader: map[string][]string{"Origin": {host.URL}}})
		if err != nil {
			t.Fatal(err)
		}
		connection.SetReadLimit(2 * 1024 * 1024)
		t.Cleanup(func() { connection.CloseNow() })
		if _, _, err := connection.Read(ctx); err != nil {
			t.Fatal(err)
		}
		return connection
	}
	slow, fast := connect("slow"), connect("fast")
	server.mu.Lock()
	output := server.sockets["slow"].output
	server.mu.Unlock()
	// A mutation completed before the stalled browser lost its response.
	var executions atomic.Int32
	if _, err := server.replay.Run(ctx, "slow", "mutation", "same", func() ([]byte, error) {
		executions.Add(1)
		return []byte(`{"ok":true}`), nil
	}); err != nil {
		t.Fatal(err)
	}
	for sequence := range 64 {
		start := time.Now()
		_ = server.Publish(ctx, "stream", map[string]any{"sequence": sequence, "text": strings.Repeat("a", 1024*1024)})
		if elapsed := time.Since(start); elapsed > time.Second {
			t.Fatalf("stalled browser blocked publication for %s", elapsed)
		}
		_, raw, err := fast.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var event struct {
			Data struct {
				Sequence int `json:"sequence"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &event) != nil || event.Data.Sequence != sequence {
			t.Fatalf("stream update lost or reordered at %d", sequence)
		}
		output.mu.Lock()
		withinLimit := output.bytes <= socketOutputBudget && len(output.queue) <= 256
		output.mu.Unlock()
		if !withinLimit {
			t.Fatal("stalled browser exceeded its output budget")
		}
	}
	output.mu.Lock()
	closed := output.closed
	output.mu.Unlock()
	if !closed {
		t.Fatal("stalled browser was not disconnected")
	}
	slow.CloseNow()
	replacement := connect("slow")
	response, err := server.replay.Run(ctx, "slow", "mutation", "same", func() ([]byte, error) {
		executions.Add(1)
		return nil, nil
	})
	if err != nil || string(response) != `{"ok":true}` || executions.Load() != 1 {
		t.Fatalf("slow-reader reconnect lost replay protection: %s, %v", response, err)
	}
	if err := server.PublishToClient(ctx, "slow", "resumed", true); err != nil {
		t.Fatal(err)
	}
	if _, response, err := replacement.Read(ctx); err != nil || !strings.Contains(string(response), `"resumed"`) {
		t.Fatalf("replacement did not receive updates: %s, %v", response, err)
	}
	// A large history frame is not itself evidence of a stalled browser. Keep
	// the following small update ordered behind it without an outbound size cap.
	fast.SetReadLimit(2 * socketOutputBudget)
	large := strings.Repeat("h", socketOutputBudget+1)
	if err := server.PublishToClient(ctx, "fast", "history", large); err != nil {
		t.Fatal(err)
	}
	if err := server.PublishToClient(ctx, "fast", "after-history", true); err != nil {
		t.Fatal(err)
	}
	_, response, err = fast.Read(ctx)
	var history struct {
		Data string `json:"data"`
	}
	if err != nil || json.Unmarshal(response, &history) != nil || history.Data != large {
		t.Fatalf("large history did not survive the backlog limit: %v", err)
	}
	if _, response, err = fast.Read(ctx); err != nil || !strings.Contains(string(response), `"after-history"`) {
		t.Fatalf("update following large history: %s, %v", response, err)
	}
}
