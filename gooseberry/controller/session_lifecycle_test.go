package controller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/coder/websocket"
)

func TestSessionManagerHonorsAgentCapabilitiesBeforeMutation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	root := t.TempDir()
	policy, err := NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := Store{Dir: t.TempDir()}
	projects := NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	records := NewSessionRecords(store)
	manager := NewSessionManager(projects, policy, records, NewSessionQueues(store), NewObjectives(store), nil)
	manager.SetObjectiveURL("http://127.0.0.1:7312/mcp/objective")
	var mode atomic.Int32 // 0: incompatible, 1: compatible, 2: HTTP MCP, 3: sanitized-equivalent replacement.
	var postInitialize atomic.Int32
	var gooseMethods atomic.Int32
	var withoutHTTPMCP atomic.Int32
	var withHTTPMCP atomic.Int32
	var loadCalls atomic.Int32
	var promptCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		for {
			_, payload, err := connection.Read(ctx)
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
				capabilities := map[string]any{}
				if mode.Load() > 0 {
					capabilities = map[string]any{
						"loadSession":         true,
						"sessionCapabilities": map[string]any{"list": map[string]any{}},
						"mcpCapabilities":     map[string]any{"http": mode.Load() >= 2},
					}
				}
				name := "fixture-agent"
				if mode.Load() == 3 {
					name = "fixture-\u202eagent"
				}
				result = map[string]any{"protocolVersion": 1, "agentInfo": map[string]any{"name": name, "version": "1.0.0"}, "agentCapabilities": capabilities, "authMethods": []any{}}
			case "session/new":
				postInitialize.Add(1)
				count := int32(len(arrayValue(rpc.Params["mcpServers"])))
				if mode.Load() == 1 {
					withoutHTTPMCP.Store(count)
					result = map[string]any{"sessionId": "generic-no-http"}
				} else {
					withHTTPMCP.Store(count)
					result = map[string]any{"sessionId": "generic-http"}
				}
			case "session/list":
				postInitialize.Add(1)
				result = map[string]any{"sessions": []any{}}
			case "session/load":
				postInitialize.Add(1)
				loadCalls.Add(1)
				result = map[string]any{}
			case "session/prompt":
				postInitialize.Add(1)
				promptCalls.Add(1)
				result = map[string]any{"stopReason": "end_turn"}
			default:
				postInitialize.Add(1)
				if strings.HasPrefix(rpc.Method, "_goose/") {
					gooseMethods.Add(1)
				}
			}
			if len(rpc.ID) > 0 && writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", manager)
	defer client.Close()
	manager.SetClient(client)

	_, err = manager.Create(ctx, project.ID, project.Roots[0], nil, "", "client")
	var coded *codedError
	if !errors.As(err, &coded) || coded.code != "UNSUPPORTED_AGENT_CAPABILITY" || !strings.Contains(err.Error(), "session/load") || !strings.Contains(err.Error(), "session/list") {
		t.Fatalf("incompatible create error: %v", err)
	}
	stored, listErr := records.List()
	manager.mu.Lock()
	live := len(manager.sessions)
	manager.mu.Unlock()
	if listErr != nil || len(stored) != 0 || live != 0 || postInitialize.Load() != 0 {
		t.Fatalf("incompatible create mutated state or reached session/new: records=%#v live=%d requests=%d err=%v", stored, live, postInitialize.Load(), listErr)
	}

	mode.Store(1)
	client.Reset()
	if _, err := manager.Create(ctx, project.ID, project.Roots[0], nil, "", "client"); err != nil {
		t.Fatal(err)
	}
	listed, err := manager.List(ctx, project.ID, false)
	if err != nil || len(listed) != 0 {
		t.Fatalf("generic session list: %#v, %v", listed, err)
	}
	admin := NewGooseAdmin(client, NewSettings(store, nil))
	if _, err := admin.providers(ctx, nil); err == nil {
		t.Fatal("generic agent accepted Goose administration")
	}
	if err := manager.Unarchive(ctx, project.ID, "generic-no-http"); err == nil {
		t.Fatal("generic agent accepted a Goose lifecycle method")
	}
	if withoutHTTPMCP.Load() != 0 || gooseMethods.Load() != 0 {
		t.Fatalf("unsupported capability reached the agent: objective servers=%d, Goose methods=%d", withoutHTTPMCP.Load(), gooseMethods.Load())
	}
	if err := manager.Prompt(ctx, "generic-no-http", "", []ImageContent{{Type: "image", MimeType: "image/png", Data: "AA=="}}); !errors.As(err, &coded) || coded.code != "UNSUPPORTED_AGENT_CAPABILITY" {
		t.Fatalf("unsupported image prompt error: %v", err)
	}
	manager.mu.Lock()
	genericEntry := manager.sessions["generic-no-http"]
	manager.mu.Unlock()
	genericEntry.state.Lock()
	mutatedPrompt := len(genericEntry.messages) != 0 || genericEntry.streaming || genericEntry.promptActive
	genericEntry.state.Unlock()
	if promptCalls.Load() != 0 || mutatedPrompt {
		t.Fatalf("unsupported image prompt mutated the session or reached the agent: requests=%d mutated=%v", promptCalls.Load(), mutatedPrompt)
	}

	mode.Store(2)
	client.Reset()
	if _, err := manager.Create(ctx, project.ID, project.Roots[0], nil, "", "client"); err != nil {
		t.Fatal(err)
	}
	if withHTTPMCP.Load() != 1 {
		t.Fatalf("advertised HTTP MCP received %d objective servers", withHTTPMCP.Load())
	}
	mode.Store(3)
	client.Reset()
	if _, err := manager.EnsureAttached(ctx, "generic-http", project.ID, project.Roots[0]); !errors.Is(err, errAgentIdentityChanged) {
		t.Fatalf("replacement agent inherited the live session: %v", err)
	}
	if loadCalls.Load() != 0 {
		t.Fatal("identity mismatch reached session/load")
	}
}

func TestStandardCommandCatalogSurvivesCreateAndLoadBoundaries(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	root := t.TempDir()
	policy, err := NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := Store{Dir: t.TempDir()}
	projects := NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "loaded", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}
	manager := NewSessionManager(projects, policy, records, NewSessionQueues(store), NewObjectives(store), nil)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		for {
			_, payload, err := connection.Read(ctx)
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
			result := any(map[string]any{})
			sessionID, command := "", ""
			switch rpc.Method {
			case "initialize":
				result = map[string]any{
					"protocolVersion": 1,
					"agentInfo":       map[string]any{"name": "fixture-agent", "version": "1.0.0"},
					"agentCapabilities": map[string]any{
						"loadSession":         true,
						"sessionCapabilities": map[string]any{"list": map[string]any{}},
					},
					"authMethods": []any{},
				}
			case "session/new":
				sessionID, command = "created", "from-create"
				result = map[string]any{"sessionId": sessionID}
			case "session/load":
				sessionID, command = "loaded", "from-load"
				if writeTestRPC(connection, map[string]any{
					"jsonrpc": "2.0",
					"method":  "session/update",
					"params": map[string]any{
						"sessionId": sessionID,
						"update": map[string]any{
							"sessionUpdate": "agent_message_chunk",
							"content":       map[string]any{"type": "text", "text": "replayed answer"},
						},
					},
				}); err != nil {
					return
				}
			}
			if command != "" {
				if writeTestRPC(connection, map[string]any{
					"jsonrpc": "2.0",
					"method":  "session/update",
					"params": map[string]any{
						"sessionId": sessionID,
						"update": map[string]any{
							"sessionUpdate":     "available_commands_update",
							"availableCommands": []any{map[string]any{"name": command}},
						},
					},
				}); err != nil {
					return
				}
			}
			if len(rpc.ID) > 0 && writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", manager)
	defer client.Close()
	manager.SetClient(client)

	value, err := manager.CreateDeferred(ctx, project.ID, project.Roots[0], nil, "", "client")
	if err != nil {
		t.Fatal(err)
	}
	deferred := value.(deferredResponse)
	created := deferred.result.(map[string]any)
	assertAgentCommand := func(value any, name string) {
		t.Helper()
		commands := value.([]map[string]any)
		if len(commands) != 1 || commands[0]["name"] != name || commands[0]["source"] != "agent" || mapValue(commands[0]["sourceInfo"])["source"] != "Connected agent" {
			t.Fatalf("agent command catalog: %#v", commands)
		}
	}
	assertAgentCommand(created["commands"], "from-create")
	deferred.after()

	var replayCommandsSerialized atomic.Bool
	manager.publish = func(channel string, data any) {
		if channel != "agent.event" {
			return
		}
		payload := mapValue(data)
		event := mapValue(payload["event"])
		commands, _ := event["commands"].([]map[string]any)
		if event["type"] != "commands" || len(commands) == 0 || commands[0]["name"] != "from-load" {
			return
		}
		manager.mu.Lock()
		entry := manager.sessions["loaded"]
		manager.mu.Unlock()
		if entry == nil {
			t.Error("replay command publication lost its session")
			return
		}
		if entry.state.TryLock() {
			entry.state.Unlock()
			t.Error("replay commands were published outside the session ordering lock")
			return
		}
		replayCommandsSerialized.Store(true)
	}
	loaded, err := manager.Messages(ctx, "loaded", project.ID, project.Roots[0], "client")
	if err != nil {
		t.Fatal(err)
	}
	assertAgentCommand(loaded["commands"], "from-load")
	if loaded["summary"].(SessionSummary).IsStreaming {
		t.Fatal("completed ACP replay remained marked as streaming")
	}
	if !replayCommandsSerialized.Load() {
		t.Fatal("replay command publication was not observed")
	}
}

func TestSessionLifecycleConflictsAndReconnectQueue(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	root := t.TempDir()
	policy, err := NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := Store{Dir: t.TempDir()}
	projects := NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	root = project.Roots[0]
	settled := make(chan string, 8)
	queuedTurns := make(chan string, 1)
	usageObserved := make(chan struct{}, 1)
	created := make(chan string, 1)
	var hiddenQueueUpdates atomic.Int32
	var observedEntry atomic.Pointer[sessionEntry]
	var manager *SessionManager
	manager = NewSessionManager(projects, policy, NewSessionRecords(store), NewSessionQueues(store), NewObjectives(store), func(channel string, data any) {
		if channel == "session.lifecycleChanged" && textValue(mapValue(data)["operation"]) == "created" {
			cwd, err := manager.RecordedCWD(textValue(mapValue(data)["projectId"]), textValue(mapValue(data)["sessionId"]))
			if err != nil {
				t.Errorf("created event preceded durable session association: %v", err)
			}
			created <- cwd
		}
		event := mapValue(mapValue(data)["event"])
		kind := textValue(event["type"])
		if kind == "queue_update" && len(arrayValue(event["followUp"])) == 0 {
			hiddenQueueUpdates.Add(1)
		}
		if kind == "usage" {
			select {
			case usageObserved <- struct{}{}:
			default:
			}
		}
		if entry := observedEntry.Load(); entry != nil && (kind == "run-start" || kind == "error" || kind == "complete") {
			if entry.state.TryLock() {
				entry.state.Unlock()
				t.Errorf("%s event was published outside the session snapshot boundary", kind)
			}
			if kind == "run-start" && entry.queue.wire(!entry.promptActive).Blocked != nil {
				t.Error("a running queued prompt was projected as an uncertain delivery")
			}
			if kind == "run-start" && entry.queue.Dispatch != nil && hiddenQueueUpdates.Load() < 2 {
				t.Error("queued prompt start did not publish an authoritative hidden queue projection")
			}
		}
		if kind == "error" || kind == "complete" {
			settled <- kind
		}
		if kind == "message_start" {
			message := mapValue(mapValue(mapValue(data)["event"])["message"])
			if message["role"] == "user" && historyText(message) == "next" {
				queuedTurns <- "next"
			}
		}
	})
	if err := manager.records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "chat", CWD: root}); err != nil {
		t.Fatal(err)
	}
	type request struct {
		connection *websocket.Conn
		id         json.RawMessage
		method     string
		params     map[string]any
		attempted  bool
	}
	requests := make(chan request, 8)
	var failLoad atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, incoming *http.Request) {
		connection, err := websocket.Accept(response, incoming, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		for {
			_, data, err := connection.Read(ctx)
			if err != nil {
				return
			}
			var rpc struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
				Params map[string]any  `json:"params"`
			}
			if json.Unmarshal(data, &rpc) != nil {
				return
			}
			var result any = map[string]any{}
			switch rpc.Method {
			case "initialize":
				result = testGooseInitializeResponse()
			case "session/new":
				result = map[string]any{"sessionId": "created"}
			case "session/load":
				if failLoad.Load() {
					_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "error": map[string]any{"code": -32603, "message": "fixture load rejected"}})
					continue
				}
				_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "method": "_goose/unstable/session/update", "params": map[string]any{"sessionId": "chat", "update": map[string]any{"sessionUpdate": "status_message", "status": map[string]any{"type": "idle"}}}})
			case "session/prompt", "session/delete", "_goose/unstable/session/archive", "_goose/unstable/session/unarchive":
				attempted := false
				if rpc.Method == "session/prompt" {
					prompt := arrayValue(rpc.Params["prompt"])
					if len(prompt) > 0 && textValue(mapValue(prompt[0])["text"]) == "next" {
						state, found, queueErr := manager.queues.Get(project.ID, "chat")
						attempted = queueErr == nil && found && state.Dispatch != nil && state.Dispatch.Attempted
					}
				}
				requests <- request{connection, rpc.ID, rpc.Method, rpc.Params, attempted}
				continue
			}
			if len(rpc.ID) > 0 {
				_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result})
			}
		}
	}))
	defer server.Close()
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "fixture", "test", manager)
	defer client.Close()
	manager.SetClient(client)
	if _, err := manager.Create(ctx, project.ID, root, nil, "", "client"); err != nil {
		t.Fatal(err)
	}
	select {
	case cwd := <-created:
		if cwd != root {
			t.Fatalf("created session directory %q, wanted %q", cwd, root)
		}
	default:
		t.Fatal("session creation did not notify connected browsers")
	}
	take := func(method string) request {
		t.Helper()
		select {
		case item := <-requests:
			if item.method != method {
				t.Fatalf("wanted %s, received %s", method, item.method)
			}
			return item
		case <-ctx.Done():
			t.Fatalf("waiting for %s: %v", method, ctx.Err())
			return request{}
		}
	}
	respond := func(item request, result any) {
		t.Helper()
		if err := writeTestRPC(item.connection, map[string]any{"jsonrpc": "2.0", "id": item.id, "result": result}); err != nil {
			t.Fatal(err)
		}
	}
	waitSettlement := func(kind string) {
		t.Helper()
		select {
		case got := <-settled:
			if got != kind {
				t.Fatalf("settlement %q, wanted %q", got, kind)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	entry, err := manager.EnsureAttached(ctx, "chat", project.ID, root)
	if err != nil {
		t.Fatal(err)
	}
	observedEntry.Store(entry)
	oldConnection := entry.context(ctx)
	entry.state.Lock()
	entry.pendingToolOutputs = map[string]toolOutput{"interrupted": {LiveText: "old preview"}}
	entry.state.Unlock()
	manager.releaseEntry(entry)
	images := []ImageContent{{Type: "image", MimeType: "image/png", Data: "AA=="}, {Type: "image", MimeType: "image/png", Data: "AQ=="}}
	if err := manager.Prompt(ctx, "chat", "", images); err != nil {
		t.Fatal(err)
	}
	initial := take("session/prompt")
	entry.state.Lock()
	retired := len(entry.pendingToolOutputs) == 0
	entry.state.Unlock()
	if !retired {
		t.Fatal("a new idle prompt retained interrupted tool previews")
	}
	if blocks := arrayValue(initial.params["prompt"]); len(blocks) != 3 || mapValue(blocks[0])["text"] != "" || mapValue(blocks[1])["data"] != "AA==" || mapValue(blocks[2])["data"] != "AQ==" {
		t.Fatal("image-only prompt changed at the ACP boundary")
	}
	if err := manager.Queue(ctx, "chat", "next"); err != nil {
		t.Fatal(err)
	}
	queuedRevision := manager.summary("chat", entry).Queue.Revision
	if err := writeTestRPC(initial.connection, map[string]any{"jsonrpc": "2.0", "method": "_goose/unstable/session/update", "params": map[string]any{"sessionId": "chat", "update": map[string]any{"sessionUpdate": "status_message", "status": map[string]any{"type": "idle"}}}}); err != nil {
		t.Fatal(err)
	}
	if err := writeTestRPC(initial.connection, map[string]any{"jsonrpc": "2.0", "method": "_goose/unstable/session/update", "params": map[string]any{"sessionId": "chat", "update": map[string]any{"sessionUpdate": "message_usage", "usage": map[string]any{"inputTokens": 1}}}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-usageObserved:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	entry.state.Lock()
	stillRunning := entry.streaming && entry.promptActive
	entry.state.Unlock()
	if !stillRunning {
		t.Fatal("terminal status ended the browser run before session/prompt returned")
	}
	if err := manager.Prompt(ctx, "chat", "overlap", nil); err == nil {
		t.Fatal("accepted a second prompt before the first prompt RPC returned")
	}
	if err := manager.SetThinking(ctx, "chat", "high"); err == nil {
		t.Fatal("changed thinking level before the prompt RPC returned")
	}
	select {
	case unexpected := <-requests:
		t.Fatalf("terminal status triggered an overlapping operation: %s", unexpected.method)
	default:
	}
	if err := manager.Archive(ctx, project.ID, "chat", root); err == nil {
		t.Fatal("archived a running chat")
	}
	client.Reset()
	waitSettlement("error")
	failLoad.Store(true)
	if loaded, err := manager.EnsureAttached(ctx, "chat", project.ID, root); err == nil {
		manager.releaseEntry(loaded)
		t.Fatal("accepted a failed reconnect load")
	}
	entry.state.Lock()
	queued := len(entry.queue.FollowUp)
	failedLoadRevision := entry.queue.Revision
	entry.state.Unlock()
	if queued != 1 || failedLoadRevision != queuedRevision {
		t.Fatal("failed load consumed the queued prompt")
	}
	if _, err := client.Prompt(oldConnection, acp.PromptRequest{SessionId: "chat", Prompt: []acp.ContentBlock{acp.TextBlock("stale")}}); err == nil {
		t.Fatal("sent a stale session operation over a new connection")
	}
	failLoad.Store(false)
	loaded, err := manager.EnsureAttached(ctx, "chat", project.ID, root)
	if err != nil {
		t.Fatal(err)
	}
	manager.releaseEntry(loaded)
	next := take("session/prompt")
	if textValue(mapValue(arrayValue(next.params["prompt"])[0])["text"]) != "next" {
		t.Fatalf("wrong queued prompt: %#v", next.params)
	}
	if !next.attempted {
		t.Fatal("queued prompt reached ACP before its attempted state was durable")
	}
	select {
	case <-queuedTurns:
	default:
		t.Fatal("drained follow-up was not published to the live transcript")
	}
	queue := manager.summary("chat", entry).Queue
	if len(queue.FollowUp) != 0 || queue.Revision == queuedRevision {
		t.Fatal("draining the queue did not advance its revision")
	}
	respond(next, map[string]any{"stopReason": "end_turn"})
	waitSettlement("complete")
	for {
		manager.mu.Lock()
		idle := entry.refs == 0
		manager.mu.Unlock()
		if idle {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(time.Millisecond):
		}
	}
	result := make(chan error, 1)
	go func() { result <- manager.Archive(ctx, project.ID, "chat", root) }()
	archive := take("_goose/unstable/session/archive")
	if err := manager.Unarchive(ctx, project.ID, "chat"); err == nil {
		t.Fatal("overlapped unarchive with archive")
	}
	if err := manager.Prompt(ctx, "chat", "conflict", nil); err == nil {
		t.Fatal("prompted a chat while archiving it")
	}
	respond(archive, map[string]any{})
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if err := manager.lockEntry("chat", entry); err == nil {
		entry.op.Unlock()
		t.Fatal("accepted a removed session projection")
	}
	go func() { result <- manager.Unarchive(ctx, project.ID, "chat") }()
	respond(take("_goose/unstable/session/unarchive"), map[string]any{})
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	go func() { result <- manager.Delete(ctx, project.ID, "chat", root) }()
	deletion := take("session/delete")
	if loaded, err := manager.EnsureAttached(ctx, "chat", project.ID, root); err == nil {
		manager.releaseEntry(loaded)
		t.Fatal("loaded a chat during deletion")
	}
	respond(deletion, map[string]any{})
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if _, err := manager.RecordedCWD(project.ID, "chat"); err == nil {
		t.Fatal("deleted chat association retained")
	}
	if _, found, err := manager.queues.Get(project.ID, "chat"); err != nil || found {
		t.Fatalf("deleted chat retained its durable queue: found=%v err=%v", found, err)
	}
	select {
	case unexpected := <-requests:
		t.Fatalf("unexpected duplicate operation: %s", unexpected.method)
	default:
	}
}
