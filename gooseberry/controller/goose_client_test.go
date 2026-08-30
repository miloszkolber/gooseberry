package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/coder/websocket"
)

type recordingGooseEvents struct {
	mu         sync.Mutex
	methods    []string
	generation uint64
}

func (e *recordingGooseEvents) SessionUpdate(context.Context, acp.SessionNotification) error {
	return nil
}
func (e *recordingGooseEvents) Extension(ctx context.Context, method string, _ json.RawMessage) error {
	e.mu.Lock()
	e.methods = append(e.methods, method)
	e.generation, _ = ctx.Value(connectionGenerationKey{}).(uint64)
	e.mu.Unlock()
	return nil
}
func (e *recordingGooseEvents) Permission(context.Context, acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	return acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}, nil
}

func TestGooseClientFramesACPAndOrdersNotifications(t *testing.T) {
	serverErrors := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-Secret-Key") != "test-secret" {
			http.Error(response, "unauthorized", http.StatusUnauthorized)
			return
		}
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			serverErrors <- err
			return
		}
		defer connection.CloseNow()
		for {
			messageType, payload, err := connection.Read(context.Background())
			if err != nil {
				return
			}
			if messageType != websocket.MessageText || strings.ContainsRune(string(payload), '\n') {
				serverErrors <- errUnsupportedACPClientMethod
				return
			}
			var rpc struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}
			if err := json.Unmarshal(payload, &rpc); err != nil {
				serverErrors <- err
				return
			}
			switch rpc.Method {
			case "initialize":
				var params struct {
					ProtocolVersion int `json:"protocolVersion"`
				}
				if json.Unmarshal(rpc.Params, &params) != nil || params.ProtocolVersion != 1 {
					serverErrors <- errUnsupportedACPClientMethod
					return
				}
				if err := writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}, "authMethods": []any{}}}); err != nil {
					serverErrors <- err
					return
				}
			case "_goose/unstable/providers/list":
				if err := writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "method": "_goose/unstable/session/update", "params": map[string]any{"kind": "fixture"}}); err != nil {
					serverErrors <- err
					return
				}
				if err := writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"providers": []any{}}}); err != nil {
					serverErrors <- err
					return
				}
			}
		}
	}))
	defer server.Close()

	events := &recordingGooseEvents{}
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "test-secret", "test", events)
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := client.Call(ctx, "_goose/unstable/providers/list", map[string]any{})
	if err != nil || string(result) != `{"providers":[]}` {
		t.Fatalf("result %s, err %v", result, err)
	}
	events.mu.Lock()
	defer events.mu.Unlock()
	if len(events.methods) != 1 || events.methods[0] != "_goose/unstable/session/update" || events.generation != 1 {
		t.Fatalf("notification was not ordered before response: %#v", events.methods)
	}
	select {
	case err := <-serverErrors:
		t.Fatal(err)
	default:
	}
}

func writeTestRPC(connection *websocket.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return connection.Write(context.Background(), websocket.MessageText, payload)
}
