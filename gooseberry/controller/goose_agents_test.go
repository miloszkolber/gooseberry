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

	"github.com/coder/websocket"
)

func TestAgentEditingAndCompletionsKeepAuthorityAndBoundaries(t *testing.T) {
	var readOnly atomic.Bool
	var sourceReads, mutations, mentionReads atomic.Int32
	updated := make(chan map[string]any, 1)
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
			source := map[string]any{"type": "agent", "name": "Scout", "description": "Inspect", "content": "Read carefully", "path": "/private/source.md", "global": true, "writable": !readOnly.Load(), "properties": map[string]any{"model": "old", "preserved": "private-property"}}
			var result any = map[string]any{}
			switch rpc.Method {
			case "initialize":
				result = testGooseInitializeResponse()
			case "_goose/unstable/sources/list":
				sourceReads.Add(1)
				result = map[string]any{"sources": []any{source, map[string]any{"type": "agent", "name": "Check", "description": "", "content": "hidden", "path": "/private/check.md", "global": true, "writable": true, "properties": map[string]any{"kind": "check"}}}}
			case "_goose/unstable/sources/update":
				mutations.Add(1)
				updated <- rpc.Params
				for _, key := range []string{"name", "description", "content", "properties"} {
					if value, ok := rpc.Params[key]; ok {
						source[key] = value
					}
				}
				result = map[string]any{"source": source}
			case "_goose/unstable/agent-mentions/list":
				mentionReads.Add(1)
				mentions := make([]any, 0)
				for index := 0; index < 70; index++ {
					mentions = append(mentions, map[string]any{"name": "Scout", "description": "Inspect", "sourceType": "agent", "mention": "@agent:Scout", "sourcePath": "/private/source.md", "raw": "private-property"})
				}
				result = map[string]any{"agents": mentions}
			case "_goose/unstable/slash-commands/list":
				result = map[string]any{"availableCommands": []any{map[string]any{"name": "compact", "description": "Compact", "path": "/private/source.md"}}}
			}
			if len(rpc.ID) > 0 && writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "fixture", "test", nil)
	defer client.Close()
	store := Store{Dir: t.TempDir()}
	root := t.TempDir()
	policy, err := NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "chat", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}
	admin := NewGooseAdmin(client, NewSettings(store, nil))
	defer admin.logins.Close()
	admin.sessions = NewSessionManager(projects, policy, records, NewSessionQueues(store), NewObjectives(store), nil)
	admin.sessions.SetClient(client)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	handle := func(method string, params map[string]any) (any, error) {
		raw, _ := json.Marshal(params)
		return admin.Handle(ctx, method, raw, "browser")
	}
	result, err := handle("goose.agentList", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	entries := result.([]map[string]any)
	encoded, _ := json.Marshal(entries)
	if len(entries) != 1 || strings.Contains(string(encoded), "/private/") || strings.Contains(string(encoded), "private-property") {
		t.Fatalf("unsafe catalog: %s", encoded)
	}
	id := entries[0]["id"]
	request := map[string]any{"id": id, "name": "Scout", "description": "Updated", "instructions": "Stay focused", "modelId": nil}
	readOnly.Store(true)
	if _, err := handle("goose.agentUpdate", request); err == nil || mutations.Load() != 0 || sourceReads.Load() != 2 {
		t.Fatal("mutation did not re-resolve current writability")
	}
	readOnly.Store(false)
	result, err = handle("goose.agentUpdate", request)
	if err != nil {
		t.Fatal(err)
	}
	params := <-updated
	properties := mapValue(params["properties"])
	if _, exists := properties["model"]; exists || properties["preserved"] != "private-property" || params["path"] != "/private/source.md" {
		t.Fatalf("properties or source path changed: %#v", params)
	}
	if mapValue(result)["modelId"] != nil {
		t.Fatal("cleared model remains in projection")
	}
	if _, err := handle("goose.agentList", map[string]any{"projectId": project.ID, "root": t.TempDir()}); err == nil || sourceReads.Load() != 3 {
		t.Fatal("unadmitted root reached Goose")
	}
	if _, err := handle("session.getAgentMentions", map[string]any{"projectId": "other", "sessionId": "chat"}); err == nil || mentionReads.Load() != 0 {
		t.Fatal("unauthorized mention lookup reached Goose")
	}
	result, err = handle("session.getAgentMentions", map[string]any{"projectId": project.ID, "sessionId": "chat"})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(result)
	if len(result.([]map[string]any)) != 64 || strings.Contains(string(encoded), "/private/") || strings.Contains(string(encoded), "private-property") {
		t.Fatalf("unbounded or unsafe mentions: %s", encoded)
	}
	result, err = handle("session.getCommands", map[string]any{"sessionId": "chat"})
	if err != nil {
		t.Fatal(err)
	}
	commands := result.([]map[string]any)
	if len(commands) != 1 || mapValue(commands[0]["sourceInfo"])["path"] != "compact" || commands[0]["source"] != "goose" {
		t.Fatalf("command projection: %#v", commands)
	}
	if _, err := agentName(strings.Repeat("ą", 41)); err == nil {
		t.Fatal("agent limit counted characters instead of UTF-8 bytes")
	}
}
