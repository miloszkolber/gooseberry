package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/coder/websocket"
)

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
	created := make(chan string, 1)
	var manager *SessionManager
	manager = NewSessionManager(projects, policy, NewSessionRecords(store), NewObjectives(store), func(channel string, data any) {
		if channel == "session.lifecycleChanged" && textValue(mapValue(data)["operation"]) == "created" {
			cwd, err := manager.RecordedCWD(textValue(mapValue(data)["projectId"]), textValue(mapValue(data)["sessionId"]))
			if err != nil {
				t.Errorf("created event preceded durable session association: %v", err)
			}
			created <- cwd
		}
		kind := textValue(mapValue(mapValue(data)["event"])["type"])
		if kind == "error" || kind == "complete" {
			settled <- kind
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
				result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}, "authMethods": []any{}}
			case "session/new":
				result = map[string]any{"sessionId": "created"}
			case "session/load":
				if failLoad.Load() {
					_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "error": map[string]any{"code": -32603, "message": "fixture load rejected"}})
					continue
				}
				_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "method": "_goose/unstable/session/update", "params": map[string]any{"sessionId": "chat", "update": map[string]any{"sessionUpdate": "status_message", "status": map[string]any{"type": "idle"}}}})
			case "session/prompt", "session/delete", "_goose/unstable/session/archive", "_goose/unstable/session/unarchive":
				requests <- request{connection, rpc.ID, rpc.Method, rpc.Params}
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
	oldConnection := entry.context(ctx)
	manager.releaseEntry(entry)
	images := []ImageContent{{Type: "image", MimeType: "image/png", Data: "AA=="}, {Type: "image", MimeType: "image/png", Data: "AQ=="}}
	if err := manager.Prompt(ctx, "chat", "", images); err != nil {
		t.Fatal(err)
	}
	initial := take("session/prompt")
	if blocks := arrayValue(initial.params["prompt"]); len(blocks) != 3 || mapValue(blocks[0])["text"] != "" || mapValue(blocks[1])["data"] != "AA==" || mapValue(blocks[2])["data"] != "AQ==" {
		t.Fatal("image-only prompt changed at the ACP boundary")
	}
	if err := manager.Queue(ctx, "chat", "next"); err != nil {
		t.Fatal(err)
	}
	queuedRevision := manager.summary("chat", entry).Queue.Revision
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
	select {
	case unexpected := <-requests:
		t.Fatalf("unexpected duplicate operation: %s", unexpected.method)
	default:
	}
}
