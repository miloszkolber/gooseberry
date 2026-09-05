package controller_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/coder/websocket"
	"github.com/miloszkolber/gooseberry/internal/controller"
)

type replayEvents struct {
	recordingEvents
	mu           sync.Mutex
	sequence     []int
	block        <-chan struct{}
	onPermission func(context.Context) error
}

func (e *replayEvents) Permission(ctx context.Context, _ acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	var err error
	if e.onPermission != nil {
		err = e.onPermission(ctx)
	}
	return acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}, err
}

func (e *replayEvents) record(index int) error {
	if e.block != nil {
		<-e.block
	}
	if index%64 == 0 {
		time.Sleep(time.Millisecond)
	}
	e.mu.Lock()
	e.sequence = append(e.sequence, index)
	e.mu.Unlock()
	return nil
}

func (e *replayEvents) SessionUpdate(_ context.Context, notification acp.SessionNotification) error {
	var index int
	if _, err := fmt.Sscan(notification.Update.AgentMessageChunk.Content.Text.Text, &index); err != nil {
		return err
	}
	return e.record(index)
}

func (e *replayEvents) Extension(_ context.Context, method string, raw json.RawMessage) error {
	if method != "_goose/unstable/session/update" {
		return fmt.Errorf("internal checkpoint reached application: %s", method)
	}
	var value struct {
		Index int `json:"index"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	return e.record(value.Index)
}

func replayServer(t *testing.T, count int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		for {
			_, raw, err := conn.Read(r.Context())
			if err != nil {
				return
			}
			var request struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			if json.Unmarshal(raw, &request) != nil {
				return
			}
			if request.Method == "" && string(request.ID) == `"permission"` {
				continue
			}
			var result any = map[string]any{}
			switch request.Method {
			case "initialize":
				result = gooseInitializeResponse()
			case "session/load":
				for index := range count {
					if index == 64 {
						if writeRPC(conn, map[string]any{"jsonrpc": "2.0", "id": "permission", "method": "session/request_permission", "params": map[string]any{"sessionId": "replay", "toolCall": map[string]any{"toolCallId": "tool", "title": "Review permission"}, "options": []any{}}}) != nil {
							return
						}
					}
					method := "session/update"
					var params any = map[string]any{"sessionId": "replay", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": fmt.Sprint(index)}}}
					if index%2 == 1 {
						method = "_goose/unstable/session/update"
						params = map[string]any{"index": index}
					}
					// Pretty-printed JSON remains one valid WebSocket message.
					frame, _ := json.MarshalIndent(map[string]any{"jsonrpc": "2.0", "method": method, "params": params}, "", " ")
					if conn.Write(r.Context(), websocket.MessageText, frame) != nil {
						return
					}
				}
			case "$/cancel_request":
				continue
			case "_goose/unstable/providers/list":
				result = map[string]any{"entries": []any{}}
			default:
				t.Errorf("unexpected outgoing method: %s", request.Method)
				return
			}
			if writeRPC(conn, map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result}) != nil {
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func TestACPUnpacedReplayPreservesOrderAndResponseBarrier(t *testing.T) {
	const count = 10000
	server := replayServer(t, count)
	events := &replayEvents{}
	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", events)
	defer client.Close()
	permissionDone := make(chan error, 1)
	events.onPermission = func(ctx context.Context) error {
		_, err := client.CallGoose(ctx, "_goose/unstable/providers/list", map[string]any{})
		permissionDone <- err
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := client.LoadSession(ctx, acp.LoadSessionRequest{SessionId: "replay", Cwd: "/tmp"}); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-permissionDone:
		if err != nil {
			t.Fatalf("inbound request could not call the agent: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("inbound request was blocked behind notification flow control")
	}
	events.mu.Lock()
	defer events.mu.Unlock()
	if len(events.sequence) != count {
		t.Fatalf("load returned before replay: %d/%d", len(events.sequence), count)
	}
	for index, actual := range events.sequence {
		if actual != index {
			t.Fatalf("notification %d was reordered as %d", index, actual)
		}
	}
}

func TestACPCloseUnblocksBackpressuredReader(t *testing.T) {
	server := replayServer(t, 2000)
	release := make(chan struct{})
	events := &replayEvents{block: release}
	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", events)
	defer client.Close()
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := client.LoadSession(ctx, acp.LoadSessionRequest{SessionId: "replay", Cwd: "/tmp"}); err == nil {
		t.Fatal("blocked load ignored cancellation")
	}
	done := make(chan struct{})
	go func() { client.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("close blocked behind notification backpressure")
	}
}
