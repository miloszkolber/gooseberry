package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
)

func TestHistoryIndexesInBatchesWithoutLeakingReplays(t *testing.T) {
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
	manager := NewSessionManager(projects, policy, NewSessionRecords(store), NewObjectives(store), nil)
	for index := 0; index < 10; index++ {
		if err := manager.records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: fmt.Sprintf("chat-%d", index), CWD: project.Roots[0]}); err != nil {
			t.Fatal(err)
		}
	}
	var loads atomic.Int32
	var forks, configurations atomic.Int32
	setup := map[string]any{
		"configOptions": []any{
			map[string]any{"type": "select", "id": "provider", "name": "Provider", "currentValue": "selected-provider", "options": []any{}},
			map[string]any{"type": "select", "id": "model", "name": "Model", "currentValue": "selected-model", "options": []any{}},
		},
		"_meta": map[string]any{"providerId": "stale-provider", "modelId": "stale-model"},
	}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		for {
			_, payload, err := connection.Read(context.Background())
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
			var result any = map[string]any{}
			switch rpc.Method {
			case "initialize":
				result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}, "authMethods": []any{}}
			case "session/list":
				sessions := make([]any, 0)
				for index := 0; index < 10; index++ {
					meta := map[string]any{}
					if index == 9 {
						meta["archivedAt"] = "2026-08-30T00:00:00Z"
					}
					sessions = append(sessions, map[string]any{"sessionId": fmt.Sprintf("chat-%d", index), "cwd": root, "title": fmt.Sprintf("Chat %d", index), "updatedAt": "2026-08-30T00:00:00Z", "_meta": meta})
				}
				result = map[string]any{"sessions": sessions}
			case "session/load":
				loads.Add(1)
				result = setup
				id := textValue(rpc.Params["sessionId"])
				for _, update := range []map[string]any{
					{"sessionUpdate": "user_message_chunk", "content": map[string]any{"type": "text", "text": "Find needle " + id}},
					{"sessionUpdate": "agent_thought_chunk", "content": map[string]any{"type": "text", "text": "Needle reasoning"}},
					{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "Needle answer"}},
					{"sessionUpdate": "tool_call_update", "toolCallId": "fixture", "status": "completed", "rawOutput": "tool-only-needle"},
				} {
					_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": id, "update": update}})
				}
				_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "method": "_goose/unstable/session/update", "params": map[string]any{"sessionId": id, "update": map[string]any{"sessionUpdate": "status_message", "status": map[string]any{"type": "idle", "message": ""}}}})
			case "session/set_config_option":
				configurations.Add(1)
				result = map[string]any{"configOptions": []any{}}
			case "session/fork":
				forks.Add(1)
				result = map[string]any{"sessionId": "forked", "configOptions": setup["configOptions"], "_meta": setup["_meta"]}
			}
			if len(rpc.ID) > 0 && writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "fixture", "test", manager)
	defer client.Close()
	manager.SetClient(client)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request := map[string]any{"query": "NEEDLE", "scope": map[string]any{"kind": "all"}, "limit": float64(2)}
	result, err := manager.history.Search(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if result["indexing"] != true || result["promptTotal"] != 8 || result["messageTotal"] != 16 || loads.Load() != 8 {
		t.Fatalf("first batch: %#v; loads %d", result, loads.Load())
	}
	result, err = manager.history.Search(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if result["indexing"] != false || result["incomplete"] != false || result["promptTotal"] != 9 || result["messageTotal"] != 18 || len(result["messages"].([]map[string]any)) != 2 || loads.Load() != 9 {
		t.Fatalf("completed index: %#v; loads %d", result, loads.Load())
	}
	manager.mu.Lock()
	retained := len(manager.sessions)
	manager.mu.Unlock()
	if retained != 0 {
		t.Fatalf("retained %d history-only transcript projections", retained)
	}
	request["scope"] = map[string]any{"kind": "chat", "sessionId": "chat-8"}
	result, err = manager.history.Search(ctx, request)
	if err != nil || result["promptTotal"] != 1 || loads.Load() != 9 {
		t.Fatalf("cached chat scope: %#v, %v", result, err)
	}
	request["query"] = "tool-only-needle"
	result, err = manager.history.Search(ctx, request)
	if err != nil || result["messageTotal"] != 0 {
		t.Fatalf("tool output entered the history index: %#v, %v", result, err)
	}
	if text := clipUTF16(strings.Repeat("🙂", 10), 5); !utf8.ValidString(text) || utf16Length(text) > 5 {
		t.Fatalf("invalid bounded Unicode: %q", text)
	}
	if text := historySnippet(strings.Repeat("İ", 100)+"needle", "needle"); !utf8.ValidString(text) || !strings.Contains(text, "needle") {
		t.Fatalf("invalid Unicode snippet: %q", text)
	}
	busy := newSessionEntry("busy", project.ID, root, "", "")
	busy.ephemeral = true
	manager.mu.Lock()
	manager.sessions["busy"] = busy
	manager.mu.Unlock()
	pinned, err := manager.entry("busy")
	if err != nil {
		t.Fatal(err)
	}
	manager.Release("busy", project.ID, root, "client")
	manager.mu.Lock()
	exists := manager.sessions["busy"] == busy
	manager.mu.Unlock()
	if !exists {
		t.Fatal("cleanup evicted an in-use projection")
	}
	manager.releaseEntry(pinned)
	manager.mu.Lock()
	exists = manager.sessions["busy"] != nil
	manager.mu.Unlock()
	if exists {
		t.Fatal("cleanup retained the released ephemeral projection")
	}
	loaded, err := manager.EnsureAttached(ctx, "chat-0", project.ID, project.Roots[0])
	if err != nil {
		t.Fatal(err)
	}
	if loaded.model == nil || loaded.model.Provider != "selected-provider" || loaded.model.ID != "selected-model" || loaded.stats.TotalMessages != len(loaded.messages) {
		t.Fatalf("load lost selected model or replay count: model %#v, stats %#v", loaded.model, loaded.stats)
	}
	loaded.state.Lock()
	loaded.title = "Retained title"
	loaded.state.Unlock()
	client.Reset()
	reattached, err := manager.EnsureAttached(ctx, "chat-0", project.ID, project.Roots[0])
	if err != nil {
		t.Fatal(err)
	}
	manager.releaseEntry(reattached)
	if reattached != loaded || loaded.title != "Retained title" || loaded.model == nil || loaded.model.ID != "selected-model" {
		t.Fatalf("reconnect lost session metadata: %#v", loaded)
	}
	if err := manager.SetThinking(ctx, "chat-0", "high"); err != nil {
		t.Fatal(err)
	}
	manager.releaseEntry(loaded)
	manager.SetObjectiveURL("http://127.0.0.1/mcp/objective")
	child, err := manager.Fork(ctx, project.ID, "chat-0", project.Roots[0])
	if err != nil || child.SessionID != "forked" || child.ParentSessionID != "chat-0" || forks.Load() != 1 || configurations.Load() != 1 {
		t.Fatalf("typed session operations: %#v, %v", child, err)
	}
	if child.Model == nil || child.Model.Provider != "selected-provider" || child.Model.ID != "selected-model" {
		t.Fatalf("fork lost selected model: %#v", child.Model)
	}
	beforeChildLoad := loads.Load()
	transcript, err := manager.Messages(ctx, child.SessionID, project.ID, project.Roots[0], "client")
	encoded, encodeErr := json.Marshal(transcript["messages"])
	if err != nil || encodeErr != nil || loads.Load() != beforeChildLoad+1 || !strings.Contains(string(encoded), "Needle answer") {
		t.Fatalf("forked chat did not load its inherited Goose transcript: %#v, %v", transcript, err)
	}
	t.Run("message snapshots preserve ownership and JSON shape", func(t *testing.T) {
		entry, err := manager.entry(child.SessionID)
		if err != nil {
			t.Fatal(err)
		}
		defer manager.releaseEntry(entry)
		for _, messages := range [][]any{nil, {}, {
			map[string]any{"role": "toolResult", "content": map[string]any{
				"text": "original tool output", "nullArray": []any(nil), "nullObject": map[string]any(nil),
			}},
			map[string]any{"role": "assistant", "content": []any{
				map[string]any{"type": "image", "data": "original-image", "mimeType": "image/png"},
				map[string]any{"type": "text", "text": "original text"},
			}},
		}} {
			entry.state.Lock()
			entry.messages = messages
			expected, err := json.Marshal(entry.messages)
			entry.state.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			snapshot, err := manager.Messages(ctx, child.SessionID, project.ID, project.Roots[0], "client")
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan struct{})
			go func() {
				defer close(done)
				for range 100 {
					entry.state.Lock()
					if len(messages) > 0 {
						mapValue(mapValue(messages[0])["content"])["text"] = "changed tool output"
						mapValue(arrayValue(mapValue(messages[1])["content"])[0])["data"] = "changed-image"
					}
					applySessionUpdate(entry, "agent_message_chunk", map[string]any{"content": map[string]any{"type": "text", "text": "later"}}, false)
					entry.state.Unlock()
				}
			}()
			for range 100 {
				encoded, err := json.Marshal(snapshot["messages"])
				if err != nil || !bytes.Equal(encoded, expected) {
					<-done
					t.Fatalf("snapshot changed during later updates: got %s, want %s, error %v", encoded, expected, err)
				}
			}
			<-done
		}
	})
	t.Run("reload snapshots linearize with live updates", func(t *testing.T) {
		entry, err := manager.entry(child.SessionID)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { manager.releaseEntry(entry) })
		t.Cleanup(func() { manager.publish = nil })

		type responseResult struct {
			value any
			err   error
		}
		updateStarted := make(chan struct{})
		publishStarted := make(chan struct{}, 1)
		publishGate := make(chan struct{})
		published := make(chan map[string]any)
		manager.publish = func(channel string, data any) {
			if channel != "agent.event" {
				return
			}
			publishStarted <- struct{}{}
			<-publishGate
			published <- mapValue(data)
		}
		updateDone := make(chan error, 1)
		go func() {
			close(updateStarted)
			updateDone <- manager.applyUpdate(context.Background(), map[string]any{
				"sessionId": child.SessionID,
				"update": map[string]any{
					"sessionUpdate": "agent_message_chunk",
					"content":       map[string]any{"type": "text", "text": "before-snapshot"},
				},
			}, false)
		}()
		<-updateStarted
		<-publishStarted
		if entry.state.TryLock() {
			entry.state.Unlock()
			close(publishGate)
			<-published
			<-updateDone
			t.Fatal("live update unlocked before publishing its event")
		}
		responseStarted := make(chan struct{})
		responseDone := make(chan responseResult, 1)
		go func() {
			close(responseStarted)
			value, err := manager.messageResponse(ctx, child.SessionID, project.ID, project.Roots[0], "client")
			responseDone <- responseResult{value: value, err: err}
		}()
		<-responseStarted
		close(publishGate)
		<-published
		if err := <-updateDone; err != nil {
			t.Fatal(err)
		}
		result := <-responseDone
		deferred, ok := result.value.(deferredResponse)
		if result.err != nil || !ok {
			t.Fatalf("message response was not deferred: %#v, %v", result.value, result.err)
		}
		t.Cleanup(deferred.after)
		encoded, _ := json.Marshal(mapValue(deferred.result)["messages"])
		if !strings.Contains(string(encoded), "before-snapshot") {
			t.Fatalf("update-first snapshot was incomplete: %s", encoded)
		}
		if entry.state.TryLock() {
			entry.state.Unlock()
			t.Fatal("update-first snapshot unlocked before its response boundary")
		}
		deferred.after()

		published = make(chan map[string]any)
		manager.publish = func(channel string, data any) {
			if channel == "agent.event" {
				published <- mapValue(data)
			}
		}
		value, err := manager.messageResponse(ctx, child.SessionID, project.ID, project.Roots[0], "client")
		deferred, ok = value.(deferredResponse)
		if err != nil || !ok {
			t.Fatalf("snapshot-first response was not holding the update boundary: %#v, %v", value, err)
		}
		t.Cleanup(deferred.after)
		if entry.state.TryLock() {
			entry.state.Unlock()
			deferred.after()
			t.Fatal("snapshot-first response unlocked before its response boundary")
		}
		encoded, _ = json.Marshal(mapValue(deferred.result)["messages"])
		secondStarted := make(chan struct{})
		updateDone = make(chan error, 1)
		go func() {
			close(secondStarted)
			updateDone <- manager.applyUpdate(context.Background(), map[string]any{
				"sessionId": child.SessionID,
				"update": map[string]any{
					"sessionUpdate": "agent_message_chunk",
					"content":       map[string]any{"type": "text", "text": "after-snapshot"},
				},
			}, false)
		}()
		<-secondStarted
		crossed := false
		select {
		case event := <-published:
			crossed = true
			t.Logf("post-snapshot event crossed the deferred response: %#v", event)
		default:
		}
		deferred.after()
		if !crossed {
			<-published
		}
		if err := <-updateDone; err != nil {
			t.Fatal(err)
		}
		if crossed {
			t.Fatal("post-snapshot event was published before the response boundary")
		}
		if strings.Contains(string(encoded), "after-snapshot") {
			t.Fatalf("snapshot included a later update: %s", encoded)
		}
	})
}
