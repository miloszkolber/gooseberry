package controller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
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

func TestGooseClientSharesSetupWithCancellableWaiters(t *testing.T) {
	client, requests := newGooseSetupFixture(t, false)
	firstContext, cancelFirst := context.WithCancel(t.Context())
	defer cancelFirst()
	first := startGooseReady(client, firstContext)
	initialize := takeGooseSetup(t, requests)
	second := startGooseReady(client, t.Context())
	cancelFirst()
	if result := takeGooseReady(t, first); !errors.Is(result.err, context.Canceled) {
		t.Fatalf("cancelled first caller: %v", result.err)
	}
	shortContext, cancelShort := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancelShort()
	if result := takeGooseReady(t, startGooseReady(client, shortContext)); !errors.Is(result.err, context.DeadlineExceeded) {
		t.Fatalf("readiness caller deadline: %v", result.err)
	}
	initialize.respond(t, acp.ProtocolVersionNumber)
	result := takeGooseReady(t, second)
	if result.err != nil || result.generation != 1 {
		t.Fatalf("shared connection: generation %d, error %v", result.generation, result.err)
	}
	if generation, err := client.Ready(t.Context()); err != nil || generation != result.generation {
		t.Fatalf("ready connection was not reused: generation %d, error %v", generation, err)
	}
	if _, err := client.Ready(firstContext); !errors.Is(err, context.Canceled) {
		t.Fatalf("ready connection ignored cancelled caller: %v", err)
	}
	select {
	case <-requests:
		t.Fatal("concurrent callers started more than one initialize")
	default:
	}
}

func TestGooseClientInterruptsSetupOnResetAndClose(t *testing.T) {
	for _, stage := range []string{"dial", "initialize"} {
		for _, operation := range []string{"reset", "close"} {
			t.Run(stage+"/"+operation, func(t *testing.T) {
				client, requests := newGooseSetupFixture(t, stage == "dial")
				waiting := startGooseReady(client, t.Context())
				pending := takeGooseSetup(t, requests)
				stopped := make(chan struct{})
				go func() {
					if operation == "close" {
						client.Close()
					} else {
						client.Reset()
					}
					close(stopped)
				}()
				select {
				case <-stopped:
				case <-time.After(time.Second):
					t.Fatal("shutdown/reset waited for network setup")
				}
				if result := takeGooseReady(t, waiting); result.err == nil {
					t.Fatal("retired setup reported ready")
				}
				select {
				case <-pending.closed:
				case <-time.After(time.Second):
					t.Fatal("retired setup left its network connection open")
				}
				if operation == "close" {
					if _, err := client.Ready(t.Context()); err == nil {
						t.Fatal("closed client reconnected")
					}
					return
				}
				retry := startGooseReady(client, t.Context())
				takeGooseSetup(t, requests).respond(t, acp.ProtocolVersionNumber)
				result := takeGooseReady(t, retry)
				if result.err != nil || result.generation != 2 {
					t.Fatalf("reset did not create a fresh generation: %#v", result)
				}
				stale := context.WithValue(t.Context(), connectionGenerationKey{}, uint64(1))
				if _, err := client.Ready(stale); err == nil {
					t.Fatal("stale attached session accepted the replacement connection")
				}
			})
		}
	}
}

func TestGooseClientFailedSetupCanRetry(t *testing.T) {
	for _, failure := range []string{"unsupported-version", "initialize-error", "timeout"} {
		t.Run(failure, func(t *testing.T) {
			client, requests := newGooseSetupFixture(t, false)
			if failure == "timeout" {
				client.Timeout = 100 * time.Millisecond
			}
			waiting := startGooseReady(client, t.Context())
			pending := takeGooseSetup(t, requests)
			switch failure {
			case "unsupported-version":
				pending.respond(t, acp.ProtocolVersionNumber+1)
			case "initialize-error":
				if err := writeTestRPC(pending.connection, map[string]any{"jsonrpc": "2.0", "id": pending.id, "error": map[string]any{"code": -32603, "message": "fixture initialize failed"}}); err != nil {
					t.Fatal(err)
				}
			}
			if result := takeGooseReady(t, waiting); result.err == nil {
				t.Fatal("failed setup reported ready")
			} else if failure == "unsupported-version" && !strings.Contains(result.err.Error(), "unsupported Goose ACP protocol version") {
				t.Fatalf("unsupported version error: %v", result.err)
			} else if failure == "timeout" && !errors.Is(result.err, context.DeadlineExceeded) {
				t.Fatalf("setup deadline: %v", result.err)
			}
			select {
			case <-pending.closed:
			case <-time.After(time.Second):
				t.Fatal("failed setup left its network connection open")
			}
			retry := startGooseReady(client, t.Context())
			takeGooseSetup(t, requests).respond(t, acp.ProtocolVersionNumber)
			if result := takeGooseReady(t, retry); result.err != nil || result.generation != 2 {
				t.Fatalf("retry did not initialize a fresh connection: %#v", result)
			}
		})
	}
}

type gooseReadyResult struct {
	generation uint64
	err        error
}

func startGooseReady(client *GooseClient, ctx context.Context) <-chan gooseReadyResult {
	result := make(chan gooseReadyResult, 1)
	go func() {
		generation, err := client.Ready(ctx)
		result <- gooseReadyResult{generation, err}
	}()
	return result
}

func takeGooseReady(t *testing.T, results <-chan gooseReadyResult) gooseReadyResult {
	t.Helper()
	select {
	case result := <-results:
		return result
	case <-time.After(time.Second):
		t.Fatal("readiness caller did not finish promptly")
		return gooseReadyResult{}
	}
}

type gooseSetupRequest struct {
	connection *websocket.Conn
	id         json.RawMessage
	closed     <-chan struct{}
}

func (r gooseSetupRequest) respond(t *testing.T, version acp.ProtocolVersion) {
	t.Helper()
	if err := writeTestRPC(r.connection, map[string]any{"jsonrpc": "2.0", "id": r.id, "result": map[string]any{"protocolVersion": version, "agentCapabilities": map[string]any{}, "authMethods": []any{}}}); err != nil {
		t.Fatal(err)
	}
}

func takeGooseSetup(t *testing.T, requests <-chan gooseSetupRequest) gooseSetupRequest {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(time.Second):
		t.Fatal("Goose connection setup did not start")
		return gooseSetupRequest{}
	}
}

func newGooseSetupFixture(t *testing.T, pauseFirstDial bool) (*GooseClient, <-chan gooseSetupRequest) {
	t.Helper()
	requests := make(chan gooseSetupRequest, 8)
	var dials atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		closed := make(chan struct{})
		defer close(closed)
		if dials.Add(1) == 1 && pauseFirstDial {
			requests <- gooseSetupRequest{closed: closed}
			<-request.Context().Done()
			return
		}
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		for {
			_, payload, err := connection.Read(t.Context())
			if err != nil {
				return
			}
			var rpc struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			if err := json.Unmarshal(payload, &rpc); err != nil {
				t.Error(err)
				return
			}
			if rpc.Method == "initialize" {
				select {
				case requests <- gooseSetupRequest{connection, rpc.ID, closed}:
				case <-t.Context().Done():
					return
				}
			}
		}
	}))
	t.Cleanup(server.Close)
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "fixture", "test", nil)
	client.Timeout = 3 * time.Second
	t.Cleanup(client.Close)
	return client, requests
}

func writeTestRPC(connection *websocket.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return connection.Write(context.Background(), websocket.MessageText, payload)
}
