package controller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
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

func TestGooseSinkRejectsGooseNotificationsFromGenericAgents(t *testing.T) {
	events := &recordingGooseEvents{}
	sink := &gooseSink{events: events, generation: 4}
	if _, err := sink.HandleExtensionMethod(t.Context(), "_goose/unstable/session/update", nil); err == nil {
		t.Fatal("generic agent notification was accepted")
	}
	if len(events.methods) != 0 {
		t.Fatalf("generic agent notification reached events: %#v", events.methods)
	}
	sink.goose.Store(true)
	if _, err := sink.HandleExtensionMethod(t.Context(), "_goose/unstable/session/update", nil); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(events.methods, []string{"_goose/unstable/session/update"}) || events.generation != 4 {
		t.Fatalf("recognized Goose notification was not projected: %#v", events.methods)
	}
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
					ProtocolVersion    int `json:"protocolVersion"`
					ClientCapabilities struct {
						Meta map[string]any `json:"_meta"`
					} `json:"clientCapabilities"`
				}
				if json.Unmarshal(rpc.Params, &params) != nil || params.ProtocolVersion != 1 {
					serverErrors <- errUnsupportedACPClientMethod
					return
				}
				goose := mapValue(params.ClientCapabilities.Meta["goose"])
				extensions := mapValue(mapValue(goose["mcpHostCapabilities"])["extensions"])
				ui := mapValue(extensions["io.modelcontextprotocol/ui"])
				mimeTypes := stringValues(ui["mimeTypes"])
				if goose["customNotifications"] != true || len(mimeTypes) != 1 || mimeTypes[0] != "text/html;profile=mcp-app" {
					serverErrors <- errUnsupportedACPClientMethod
					return
				}
				if err := writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": testGooseInitializeResponse()}); err != nil {
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
	result, err := client.CallGoose(ctx, "_goose/unstable/providers/list", map[string]any{})
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

func TestGooseReadLimitFitsWorstCaseAppResourceFrame(t *testing.T) {
	html := strings.Repeat("\x00", maxAppViewHTMLBytes)
	frame, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"contents": []any{map[string]any{
				"uri":      "ui://fixture/app.html",
				"mimeType": appViewMediaType,
				"text":     html,
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(frame) > gooseReadLimit {
		t.Fatalf("maximally escaped App frame is %d bytes; read limit is %d", len(frame), gooseReadLimit)
	}
	if remaining := gooseReadLimit - len(frame); remaining < 1024*1024 {
		t.Fatalf("App frame leaves only %d bytes for metadata", remaining)
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
			} else if failure == "unsupported-version" && !strings.Contains(result.err.Error(), "unsupported ACP protocol version") {
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
	result := testGooseInitializeResponse()
	result["protocolVersion"] = version
	r.respondResult(t, result)
}

func (r gooseSetupRequest) respondResult(t *testing.T, result map[string]any) {
	t.Helper()
	if err := writeTestRPC(r.connection, map[string]any{"jsonrpc": "2.0", "id": r.id, "result": result}); err != nil {
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

func TestAgentProfileUsesAdvertisedCapabilitiesAndExactGooseMarker(t *testing.T) {
	decode := func(value map[string]any) acp.InitializeResponse {
		t.Helper()
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var response acp.InitializeResponse
		if err := json.Unmarshal(encoded, &response); err != nil {
			t.Fatal(err)
		}
		return response
	}

	goose := testGooseInitializeResponse()
	profile := agentProfile(decode(goose))
	if !profile.Goose || !profile.Compatible || len(profile.MissingRequired) != 0 {
		t.Fatalf("recognized Goose profile: %#v", profile)
	}
	if cloneAgentProfile(profile).MissingRequired == nil {
		t.Fatal("compatible profile encoded missingRequired as null")
	}
	if !profile.Operations.DeleteSession || !profile.Operations.ForkSession || !profile.Operations.PromptImage || !profile.Operations.HTTPMCP || !profile.Operations.Steer || !profile.Operations.RenameSession || !profile.Operations.ArchiveSession || !profile.Operations.Administration {
		t.Fatalf("recognized Goose operations: %#v", profile.Operations)
	}

	generic := testGooseInitializeResponse()
	generic["agentInfo"] = map[string]any{"name": " Goose\n\u202e", "version": strings.Repeat("v", maxAgentVersionRunes+10) + "\x00"}
	capabilities := generic["agentCapabilities"].(map[string]any)
	delete(capabilities, "_meta")
	capabilities["sessionCapabilities"].(map[string]any)["fork"] = map[string]any{}
	profile = agentProfile(decode(generic))
	if profile.Goose || profile.Name != "Goose" || len([]rune(profile.Version)) != maxAgentVersionRunes {
		t.Fatalf("generic identity recognition/sanitization: %#v", profile)
	}
	if !profile.Operations.ForkSession || profile.Operations.Steer || profile.Operations.RenameSession || profile.Operations.ArchiveSession || profile.Operations.Administration {
		t.Fatalf("generic operations: %#v", profile.Operations)
	}

	missing := map[string]any{
		"protocolVersion": 1,
		"agentInfo":       map[string]any{"name": "agent", "version": "1"},
		"agentCapabilities": map[string]any{
			"sessionCapabilities": map[string]any{},
		},
		"authMethods": []any{},
	}
	profile = agentProfile(decode(missing))
	if profile.Compatible || !slices.Equal(profile.MissingRequired, []string{"session/load", "session/list"}) {
		t.Fatalf("missing required capabilities: %#v", profile)
	}
}

func TestGooseClientPublishesOnlySuccessfulImmutableProfiles(t *testing.T) {
	client, requests := newGooseSetupFixture(t, false)
	profiles := make(chan AgentProfile, 2)
	client.profileChanged = func(profile AgentProfile) { profiles <- profile }

	type result struct {
		generation uint64
		profile    AgentProfile
		err        error
	}
	ready := make(chan result, 1)
	go func() {
		generation, profile, err := client.Profile(t.Context())
		ready <- result{generation: generation, profile: profile, err: err}
	}()
	pending := takeGooseSetup(t, requests)
	incompatible := map[string]any{
		"protocolVersion": 1,
		"agentInfo":       map[string]any{"name": "generic", "version": "1.0.0"},
		"agentCapabilities": map[string]any{
			"sessionCapabilities": map[string]any{},
		},
		"authMethods": []any{},
	}
	pending.respondResult(t, incompatible)
	first := <-ready
	if first.err != nil || first.generation != 1 || first.profile.Name != "generic" {
		t.Fatalf("profile result: %#v", first)
	}
	var published AgentProfile
	select {
	case published = <-profiles:
	case <-time.After(time.Second):
		t.Fatal("successful profile was not published")
	}
	first.profile.MissingRequired[0] = "mutated-return"
	published.MissingRequired[0] = "mutated-event"
	_, stored, err := client.Profile(t.Context())
	if err != nil || !slices.Equal(stored.MissingRequired, []string{"session/load", "session/list"}) {
		t.Fatalf("connection profile shared mutable storage: %#v, %v", stored, err)
	}

	client.Reset()
	failed := startGooseReady(client, t.Context())
	failedSetup := takeGooseSetup(t, requests)
	failedResult := testGooseInitializeResponse()
	failedResult["protocolVersion"] = acp.ProtocolVersionNumber + 1
	failedSetup.respondResult(t, failedResult)
	if result := takeGooseReady(t, failed); result.err == nil {
		t.Fatal("failed initialize reported ready")
	}
	select {
	case profile := <-profiles:
		t.Fatalf("failed initialize published a profile: %#v", profile)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestAgentProfilePublicationDoesNotRegressToAnOlderGeneration(t *testing.T) {
	client := &GooseClient{}
	var published []string
	publish := func(profile AgentProfile) { published = append(published, profile.Name) }
	client.publishProfile(2, publish, AgentProfile{Name: "new"})
	client.publishProfile(1, publish, AgentProfile{Name: "old"})
	if !slices.Equal(published, []string{"new"}) {
		t.Fatalf("profile publication regressed: %#v", published)
	}
}

func TestGooseClientRejectsUnadvertisedStandardAndGooseOperationsBeforeWire(t *testing.T) {
	methods := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
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
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			if rpc.Method == "initialize" {
				result := map[string]any{
					"protocolVersion": 1,
					"agentInfo":       map[string]any{"name": "generic", "version": "1"},
					"agentCapabilities": map[string]any{
						"sessionCapabilities": map[string]any{},
					},
					"authMethods": []any{},
				}
				_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result})
				continue
			}
			methods <- rpc.Method
			_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "error": map[string]any{"code": -32601, "message": "unexpected wire request"}})
		}
	}))
	defer server.Close()
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", nil)
	defer client.Close()

	assertUnsupported := func(operation string, err error) {
		t.Helper()
		var coded *codedError
		if !errors.As(err, &coded) || coded.code != "UNSUPPORTED_AGENT_CAPABILITY" {
			t.Fatalf("%s error: %v", operation, err)
		}
	}
	_, err := client.ListSessions(t.Context(), acp.ListSessionsRequest{})
	assertUnsupported("list", err)
	_, err = client.LoadSession(t.Context(), acp.LoadSessionRequest{SessionId: "session", Cwd: "/tmp", McpServers: []acp.McpServer{}})
	assertUnsupported("load", err)
	err = client.DeleteSession(t.Context(), "session")
	assertUnsupported("delete", err)
	_, err = client.ForkSession(t.Context(), acp.UnstableForkSessionRequest{SessionId: "session", Cwd: "/tmp"})
	assertUnsupported("fork", err)
	_, err = client.Prompt(t.Context(), acp.PromptRequest{SessionId: "session", Prompt: []acp.ContentBlock{{Image: &acp.ContentBlockImage{Type: "image", Data: "AA==", MimeType: "image/png"}}}})
	assertUnsupported("image", err)
	_, err = client.CallGoose(t.Context(), "_goose/unstable/example", map[string]any{})
	assertUnsupported("Goose-specific", err)
	select {
	case method := <-methods:
		t.Fatalf("unadvertised operation reached the agent: %s", method)
	default:
	}
}
