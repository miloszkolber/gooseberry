package controller_test

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/coder/websocket"
	"github.com/miloszkolber/gooseberry/internal/controller"
	"github.com/miloszkolber/gooseberry/internal/persist"
	"github.com/miloszkolber/gooseberry/internal/workspace"
)

func newSessionManager(t *testing.T, loadUpdates []map[string]any, promptRequests chan<- map[string]any) (*controller.SessionManager, *controller.GooseClient, workspace.Project, persist.Store) {
	t.Helper()
	ctx := t.Context()
	root := t.TempDir()
	policy, err := workspace.NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := persist.Store{Dir: t.TempDir()}
	projects := workspace.NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	records := controller.NewSessionRecords(store)
	if err := records.Record(controller.ProjectSessionRecord{ProjectID: project.ID, SessionID: "chat", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}
	manager := controller.NewSessionManager(projects, policy, records, controller.NewSessionQueues(store), controller.NewObjectives(store), nil)
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
				result = gooseInitializeResponse()
			case "session/load":
				for _, loadUpdate := range loadUpdates {
					if writeRPC(connection, map[string]any{
						"jsonrpc": "2.0", "method": "session/update",
						"params": map[string]any{"sessionId": "chat", "update": loadUpdate},
					}) != nil {
						return
					}
				}
			case "session/prompt":
				if promptRequests != nil {
					promptRequests <- map[string]any{"connection": connection, "id": rpc.ID, "params": rpc.Params}
					continue
				}
			}
			if len(rpc.ID) > 0 && writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", manager)
	manager.SetClient(client)
	t.Cleanup(client.Close)
	return manager, client, project, store
}

func TestPermissionsAndQuestionsStaySessionBoundAndSingleUse(t *testing.T) {
	questionArgs := map[string]any{"questions": []any{map[string]any{
		"header": "Choice", "question": "Choose one", "options": []any{map[string]any{"label": "A", "description": "First option"}},
	}}}
	manager, client, project, _ := newSessionManager(t, []map[string]any{
		{"sessionUpdate": "user_message_chunk", "content": map[string]any{"type": "text", "text": "Need input"}},
		{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "Choose carefully"}},
		{"sessionUpdate": "tool_call", "toolCallId": "question-tool", "title": "ask_user_question", "rawInput": questionArgs},
	}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	snapshot, err := manager.Messages(ctx, "chat", project.ID, project.Roots[0], "client")
	if err != nil {
		t.Fatal(err)
	}
	assertReplay := func(snapshot map[string]any) {
		t.Helper()
		messages := snapshot["messages"].([]any)
		if len(messages) != 2 || messages[0].(map[string]any)["role"] != "user" || messages[1].(map[string]any)["role"] != "assistant" {
			t.Fatalf("replay message ordering: %#v", messages)
		}
		assistant := messages[1].(map[string]any)["content"].([]any)
		if len(assistant) != 2 || assistant[0].(map[string]any)["text"] != "Choose carefully" || assistant[1].(map[string]any)["id"] != "question-tool" {
			t.Fatalf("replay tool ordering: %#v", assistant)
		}
	}
	assertReplay(snapshot)
	client.Reset()
	snapshot, err = manager.Messages(ctx, "chat", project.ID, project.Roots[0], "client")
	if err != nil {
		t.Fatal(err)
	}
	assertReplay(snapshot)

	title := "Write a file"
	permissionResult := make(chan acp.RequestPermissionResponse, 1)
	go func() {
		result, _ := manager.Permission(ctx, acp.RequestPermissionRequest{
			SessionId: "chat",
			ToolCall:  acp.ToolCallUpdate{ToolCallId: "write-tool", Title: &title},
			Options: []acp.PermissionOption{{
				OptionId: "allow-once", Name: "Allow once", Kind: acp.PermissionOptionKindAllowOnce,
			}},
		})
		permissionResult <- result
	}()
	var pending map[string]any
	for pending == nil {
		items := manager.PendingPermissions()
		if len(items) == 1 {
			pending = items[0]
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("permission request did not become visible")
		case <-time.After(time.Millisecond):
		}
	}
	permissionID, _ := pending["id"].(string)
	if pending["sessionId"] != "chat" || pending["toolCallId"] != "write-tool" || permissionID == "" {
		t.Fatalf("permission projection: %#v", pending)
	}
	if err := manager.ResolvePermission("other", permissionID, "allow-once"); err == nil {
		t.Fatal("permission crossed session ownership")
	}
	if err := manager.ResolvePermission("chat", permissionID, "unknown"); err == nil {
		t.Fatal("permission accepted an unadvertised option")
	}
	if err := manager.ResolvePermission("chat", permissionID, "allow-once"); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-permissionResult:
		if result.Outcome.Selected == nil || result.Outcome.Selected.OptionId != "allow-once" {
			t.Fatalf("permission result: %#v", result)
		}
	case <-ctx.Done():
		t.Fatal("permission result did not settle")
	}
	if err := manager.ResolvePermission("chat", permissionID, "allow-once"); err == nil {
		t.Fatal("permission response was accepted twice")
	}

	questionResult := make(chan map[string]any, 1)
	go func() {
		result, _ := manager.AskQuestion("chat", questionArgs)
		questionResult <- result
	}()
	malformed := map[string]any{"answers": []any{map[string]any{"questionIndex": 2}}, "cancelled": false}
	for {
		err := manager.ResolveQuestion("chat", "question-tool", malformed)
		if err != nil && strings.Contains(err.Error(), "no longer awaiting") {
			select {
			case <-ctx.Done():
				t.Fatal("question did not become pending")
			case <-time.After(time.Millisecond):
				continue
			}
		}
		if err == nil || !strings.Contains(err.Error(), "malformed") {
			t.Fatalf("malformed question response: %v", err)
		}
		break
	}
	answer := map[string]any{"answers": []any{map[string]any{
		"questionIndex": 0, "question": "Choose one", "kind": "option", "answer": "A",
	}}, "cancelled": false}
	if err := manager.ResolveQuestion("other", "question-tool", answer); err == nil {
		t.Fatal("question response crossed session ownership")
	}
	if err := manager.ResolveQuestion("chat", "question-tool", answer); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-questionResult:
		if result["cancelled"] != false || len(result["answers"].([]any)) != 1 {
			t.Fatalf("question result: %#v", result)
		}
	case <-ctx.Done():
		t.Fatal("question result did not settle")
	}
	if err := manager.ResolveQuestion("chat", "question-tool", answer); err == nil {
		t.Fatal("question response was accepted twice")
	}
}

func TestConcurrentPromptQueuesAndLifecycleRemainSerialized(t *testing.T) {
	requests := make(chan map[string]any, 4)
	manager, _, project, store := newSessionManager(t, nil, requests)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := manager.Messages(ctx, "chat", project.ID, project.Roots[0], "client"); err != nil {
		t.Fatal(err)
	}
	if err := manager.Prompt(ctx, "chat", "first", nil); err != nil {
		t.Fatal(err)
	}
	first := <-requests
	if err := manager.Prompt(ctx, "chat", "overlap", nil); err == nil {
		t.Fatal("accepted a concurrent prompt")
	}
	if err := manager.Archive(ctx, project.ID, "chat", project.Roots[0]); err == nil {
		t.Fatal("archived a running chat")
	}
	if err := manager.Queue(ctx, "chat", "next"); err != nil {
		t.Fatal(err)
	}
	queue, found, err := controller.NewSessionQueues(store).Get(project.ID, "chat")
	if err != nil || !found || len(queue.FollowUp) != 1 || queue.FollowUp[0].Text != "next" {
		t.Fatalf("durable queued follow-up: found=%v state=%#v err=%v", found, queue, err)
	}
	if err := writeRPC(first["connection"].(*websocket.Conn), map[string]any{
		"jsonrpc": "2.0", "id": first["id"], "result": map[string]any{"stopReason": "end_turn"},
	}); err != nil {
		t.Fatal(err)
	}
	var second map[string]any
	select {
	case second = <-requests:
	case <-ctx.Done():
		t.Fatal("queued follow-up did not start")
	}
	prompt := second["params"].(map[string]any)["prompt"].([]any)
	if len(prompt) != 1 || prompt[0].(map[string]any)["text"] != "next" {
		t.Fatalf("wrong queued prompt: %#v", prompt)
	}
	queue, found, err = controller.NewSessionQueues(store).Get(project.ID, "chat")
	if err != nil || !found || queue.Dispatch == nil || !queue.Dispatch.Attempted || len(queue.FollowUp) != 0 {
		t.Fatalf("dispatch was not made durable before ACP: found=%v state=%#v err=%v", found, queue, err)
	}
	if err := writeRPC(second["connection"].(*websocket.Conn), map[string]any{
		"jsonrpc": "2.0", "id": second["id"], "result": map[string]any{"stopReason": "end_turn"},
	}); err != nil {
		t.Fatal(err)
	}
	for {
		queue, found, err = controller.NewSessionQueues(store).Get(project.ID, "chat")
		if err == nil && found && queue.Dispatch == nil && len(queue.FollowUp) == 0 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("queue did not settle: found=%v state=%#v err=%v", found, queue, err)
		case <-time.After(time.Millisecond):
		}
	}
}

func TestRuntimeResumesDurableFollowUpsAfterRestart(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	requests := make(chan map[string]any, 2)
	agent := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
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
			if rpc.Method == "initialize" {
				result = gooseInitializeResponse()
			}
			if rpc.Method == "session/prompt" {
				requests <- map[string]any{"connection": connection, "id": rpc.ID, "params": rpc.Params}
				continue
			}
			if len(rpc.ID) > 0 && writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer agent.Close()

	dataDir, root := t.TempDir(), t.TempDir()
	policy, err := workspace.NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := persist.Store{Dir: dataDir}
	projects := workspace.NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := controller.NewSessionRecords(store).Record(controller.ProjectSessionRecord{ProjectID: project.ID, SessionID: "chat", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}
	queueDocument := map[string]any{
		"version": 1, "engine": "goose", "records": []any{map[string]any{
			"projectId": project.ID, "sessionId": "chat", "revision": "restart",
			"followUp": []any{map[string]any{"id": "queued", "text": "resume me"}}, "handled": []any{},
		}},
	}
	if err := persist.Write(store, "session-queues.json", queueDocument, nil); err != nil {
		t.Fatal(err)
	}
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	runtime, err := controller.NewRuntime(controller.RuntimeConfig{
		Host: "127.0.0.1", Port: port, DataDir: dataDir, StaticDir: staticDir,
		GooseURL: "ws" + strings.TrimPrefix(agent.URL, "http"), Policy: policy,
		Getenv: func(string) string { return "" },
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.Start(); err != nil {
		t.Fatal(err)
	}
	defer runtime.Shutdown(context.Background())
	var request map[string]any
	select {
	case request = <-requests:
	case <-ctx.Done():
		t.Fatal("restart did not resume queued work")
	}
	prompt := request["params"].(map[string]any)["prompt"].([]any)
	if len(prompt) != 1 || prompt[0].(map[string]any)["text"] != "resume me" {
		t.Fatalf("wrong recovered prompt: %#v", prompt)
	}
	queue, found, err := controller.NewSessionQueues(store).Get(project.ID, "chat")
	if err != nil || !found || queue.Dispatch == nil || !queue.Dispatch.Attempted {
		t.Fatalf("recovered delivery was not durable before ACP: found=%v state=%#v err=%v", found, queue, err)
	}
	if err := writeRPC(request["connection"].(*websocket.Conn), map[string]any{
		"jsonrpc": "2.0", "id": request["id"], "result": map[string]any{"stopReason": "end_turn"},
	}); err != nil {
		t.Fatal(err)
	}
	for {
		queue, found, err = controller.NewSessionQueues(store).Get(project.ID, "chat")
		if err == nil && found && queue.Dispatch == nil && len(queue.FollowUp) == 0 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("recovered queue did not settle: found=%v state=%#v err=%v", found, queue, err)
		case <-time.After(time.Millisecond):
		}
	}
}
