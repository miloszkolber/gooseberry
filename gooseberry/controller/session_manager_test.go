package controller

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	acp "github.com/coder/acp-go-sdk"
)

func TestToolOutputSurvivesPartialUpdatesAndInterleavedReplay(t *testing.T) {
	entry := newSessionEntry("chat", "project", "/project", "", "")
	image := []any{map[string]any{"type": "content", "content": map[string]any{"type": "image", "data": "AA==", "mimeType": "image/png"}}}
	apply := func(id string, update map[string]any) any {
		t.Helper()
		update["toolCallId"] = id
		return applySessionUpdate(entry, "tool_call_update", update, false)[0]["tool"]
	}
	apply("image", map[string]any{"status": "in_progress", "content": image})
	apply("other", map[string]any{"status": "in_progress", "rawOutput": "previous"})
	apply("image", map[string]any{"rawOutput": map[string]any{"width": 10}})
	got := apply("image", map[string]any{"status": "completed"})
	want := map[string]any{"structuredContent": map[string]any{"width": 10}, "content": image}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(mapValue(entry.messages[0])["content"], want) {
		t.Fatalf("mixed image result was lost from live output or history: %#v", got)
	}
	for _, value := range []any{false, "", []any{}} {
		apply("other", map[string]any{"rawOutput": value})
		got = apply("other", map[string]any{"status": "failed"})
		message := mapValue(entry.messages[len(entry.messages)-1])
		if !reflect.DeepEqual(got, value) || !reflect.DeepEqual(message["content"], value) || message["isError"] != true {
			t.Fatalf("explicit output or failure was overwritten: %#v", message)
		}
	}
	if len(entry.pendingToolOutputs) != 0 {
		t.Fatal("completed tools retained transient output")
	}
	entry.attached = 1
	entry.replay = newSessionEntry("chat", "project", "/project", "", "")
	entry.replay.attached = 2
	manager := &SessionManager{sessions: map[string]*sessionEntry{"chat": entry}}
	update := map[string]any{"sessionId": "chat", "update": map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "replayed", "rawOutput": "new output"}}
	if err := manager.applyUpdate(context.WithValue(context.Background(), connectionGenerationKey{}, uint64(2)), update, false); err != nil {
		t.Fatal(err)
	}
	mapValue(update["update"])["rawOutput"] = "stale output"
	if err := manager.applyUpdate(context.WithValue(context.Background(), connectionGenerationKey{}, uint64(1)), update, false); err != nil {
		t.Fatal(err)
	}
	if len(entry.pendingToolOutputs) != 0 || entry.replay.pendingToolOutputs["replayed"].Raw != "new output" {
		t.Fatal("old connection output entered a replacement replay")
	}
}

func TestShellLiveOutputIsOrderedBoundedAndReplacedByFinalResult(t *testing.T) {
	entry := newSessionEntry("chat", "project", "/project", "", "")
	live := func(sequence float64, text string) any {
		return projectToolOutput(entry, "shell", map[string]any{"_meta": map[string]any{"toolNotification": map[string]any{
			"type": "live_output", "params": map[string]any{"sequence": sequence, "chunks": []any{map[string]any{"stream": "stdout", "output": text}}},
		}}}, false)
	}
	if live(1, "first\n") != "first\n" || live(2, "second\n") != "first\nsecond\n" || live(1, "duplicate") != "first\nsecond\n" {
		t.Fatal("live deltas were lost, reordered or duplicated")
	}
	bounded := textValue(live(3, strings.Repeat("界", 100*1024)))
	if len(entry.pendingToolOutputs["shell"].LiveText) > 256*1024 || !utf8.ValidString(bounded) || !strings.HasSuffix(bounded, "[Live output truncated]") {
		t.Fatal("live output bypassed its byte bound or silently truncated a character")
	}
	if got := projectToolOutput(entry, "shell", map[string]any{"rawOutput": "final"}, true); got != "final" || len(entry.pendingToolOutputs) != 0 {
		t.Fatalf("final output did not replace the streaming preview: %#v", got)
	}
	live(1, "retained on completion")
	if got := projectToolOutput(entry, "shell", map[string]any{}, true); got != "retained on completion" {
		t.Fatalf("status-only completion erased the streaming preview: %#v", got)
	}
}

func TestMCPAppProjectionRequiresTrustedGooseAttachment(t *testing.T) {
	entry := newSessionEntry("chat", "project", "/project", "", "")
	base := map[string]any{
		"sessionUpdate": "tool_call_update",
		"toolCallId":    "app-call",
		"status":        "in_progress",
		"_meta": map[string]any{"goose": map[string]any{"mcpApp": map[string]any{
			"toolName":         "apps__create_app",
			"toolNameIsActual": false,
			"extensionName":    "apps",
			"resourceUri":      "ui://apps/fixture",
		}}},
	}
	event := applySessionUpdate(entry, "tool_call_update", base, false)[0]
	if event["app"] != nil || len(entry.appAttachments) != 0 {
		t.Fatal("extension-shaped metadata was treated as a trusted App attachment")
	}
	app := mapValue(mapValue(mapValue(base["_meta"])["goose"])["mcpApp"])
	app["toolNameIsActual"] = true
	app["toolMeta"] = map[string]any{"ui": map[string]any{"prefersBorder": true}}
	app["resourceResult"] = map[string]any{"contents": []any{map[string]any{
		"uri":      "ui://apps/fixture",
		"mimeType": "text/html;profile=mcp-app",
		"text":     "<main>Fixture</main>",
	}}}
	event = applySessionUpdate(entry, "tool_call_update", base, false)[0]
	projected := mapValue(event["app"])
	if projected["extensionName"] != "apps" || projected["resourceUri"] != "ui://apps/fixture" {
		t.Fatalf("trusted attachment projection: %#v", projected)
	}
	if len(projected) != 3 {
		t.Fatalf("resource HTML or internal metadata escaped the narrow projection: %#v", projected)
	}
	retained := entry.appAttachments["app-call"]
	if retained.attachment != (AppAttachment{
		ToolName: "apps__create_app", ExtensionName: "apps", ResourceURI: "ui://apps/fixture",
	}) {
		t.Fatalf("App session state retained more than trusted authority: %#v", retained)
	}
	projected["toolName"] = "mutated"
	finished := applySessionUpdate(entry, "tool_call_update", map[string]any{
		"sessionUpdate": "tool_call_update",
		"toolCallId":    "app-call",
		"status":        "completed",
	}, false)[0]
	finalApp := mapValue(finished["app"])
	messageApp := mapValue(mapValue(entry.messages[len(entry.messages)-1])["app"])
	if finalApp["toolName"] != "apps__create_app" || !reflect.DeepEqual(finalApp, messageApp) {
		t.Fatalf("status-only completion lost or shared mutable App metadata: event %#v, history %#v", finalApp, messageApp)
	}
	direct := cloneJSON(base).(map[string]any)
	direct["toolCallId"] = "direct-app"
	direct["status"] = "completed"
	applySessionUpdate(entry, "tool_call_update", direct, false)
	details := mapValue(mapValue(entry.messages[len(entry.messages)-1])["details"])
	encodedDetails, _ := json.Marshal(details)
	if strings.Contains(string(encodedDetails), "<main>Fixture</main>") || mapValue(mapValue(details["_meta"])["goose"])["mcpApp"] != nil {
		t.Fatalf("resolved App resource escaped through raw transcript details: %#v", details)
	}
	applySessionUpdate(entry, "tool_call", map[string]any{"toolCallId": "app-call", "title": "replacement"}, false)
	if _, retained := entry.appAttachments["app-call"]; retained {
		t.Fatal("a reused tool call id retained the previous App authority")
	}
}

func TestQueueRevisionRejectsStaleAndConcurrentMutations(t *testing.T) {
	manager := &SessionManager{sessions: map[string]*sessionEntry{}, now: time.Now}
	entry := newSessionEntry("session", "project", "/project", "", "token")
	entry.queue.FollowUp = []string{"same", "same"}
	manager.sessions["session"] = entry
	handler := CoreHandler{Sessions: manager}
	for _, method := range []string{"session.queueEdit", "session.queueRemove"} {
		_, err := handler.Handle(context.Background(), method, json.RawMessage(`{"sessionId":"session","lane":"followUp","index":0,"text":"edited"}`), "client")
		if err == nil || !strings.Contains(err.Error(), "reload Gooseberry") {
			t.Fatalf("old client did not receive a reload instruction: %v", err)
		}
	}
	if len(entry.queue.FollowUp) != 2 || entry.queue.FollowUp[0] != "same" {
		t.Fatal("a request without a revision changed the queue")
	}
	original := entry.queue.Revision
	if err := manager.RemoveQueue("session", "followUp", 0, original); err != nil {
		t.Fatal(err)
	}
	if entry.queue.Revision == original || len(entry.queue.FollowUp) != 1 {
		t.Fatal("removing an entry did not advance the queue revision")
	}
	// Index and text match again, but this is a different queued message.
	if err := manager.EditQueue("session", "followUp", 0, "stale edit", original); err == nil {
		t.Fatal("a stale edit replaced the next identical message")
	}
	if err := manager.RemoveQueue("session", "followUp", 0, original); err == nil {
		t.Fatal("a stale removal deleted the next identical message")
	}
	revision := entry.queue.Revision
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, text := range []string{"first edit", "second edit"} {
		go func() {
			<-start
			results <- manager.EditQueue("session", "followUp", 0, text, revision)
		}()
	}
	close(start)
	accepted := 0
	for range 2 {
		if <-results == nil {
			accepted++
		}
	}
	if accepted != 1 || entry.queue.Revision == revision || len(entry.queue.FollowUp) != 1 {
		t.Fatal("concurrent edits did not accept exactly one current revision")
	}
	if manager.summary("session", entry).Queue.Revision != entry.queue.Revision {
		t.Fatal("reconnect summary lost the queue revision")
	}
}

func TestPromptImagesAndQuestionRepliesRejectMalformedBoundaries(t *testing.T) {
	for _, value := range []string{"AB==", "AA=", "AA==\n", "A===", "===="} {
		if _, err := promptBlocks("hello", []ImageContent{{Type: "image", MimeType: "image/png", Data: value}}); err == nil {
			t.Fatalf("accepted non-canonical image %q", value)
		}
	}
	if _, err := promptBlocks("hello", []ImageContent{{Type: "image", MimeType: "image/png", Data: "AA=="}}); err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"questions": []any{map[string]any{"question": "Proceed?", "header": "Next", "options": []any{map[string]any{"label": "Yes", "description": "Continue"}}}}}
	var reordered map[string]any
	if err := json.Unmarshal([]byte(`{"questions":[{"options":[{"description":"Continue","label":"Yes"}],"header":"Next","question":"Proceed?"}]}`), &reordered); err != nil || stableJSON(args) != stableJSON(reordered) {
		t.Fatal("question identity depends on JSON object key order")
	}
	answer := map[string]any{"questionIndex": float64(0), "question": "Proceed?", "kind": "option", "answer": "Yes"}
	result := map[string]any{"answers": []any{answer}, "cancelled": false}
	if err := validateQuestionResult(result, args); err != nil {
		t.Fatal(err)
	}
	answer["questionIndex"] = 0.5
	if err := validateQuestionResult(result, args); err == nil {
		t.Fatal("accepted fractional question index")
	}
	answer["questionIndex"] = float64(0)
	answer["preview"] = "invented preview"
	if err := validateQuestionResult(result, args); err == nil {
		t.Fatal("accepted a forged option preview")
	}
	manager := &SessionManager{sessions: map[string]*sessionEntry{}, now: time.Now}
	entry := newSessionEntry("session", "project", "/project", "", "token")
	entry.queue.FollowUp = []string{"Keep this queued message"}
	manager.sessions["session"] = entry
	handler := CoreHandler{Sessions: manager}
	for _, malformed := range []string{
		`{"sessionId":"session","lane":"followUp"}`,
		`{"sessionId":"session","lane":"followUp","index":null}`,
		`{"sessionId":"session","lane":"followUp","index":0.5}`,
	} {
		if _, err := handler.Handle(context.Background(), "session.queueRemove", json.RawMessage(malformed), "client"); err == nil {
			t.Fatalf("accepted malformed queue removal: %s", malformed)
		}
	}
	if len(entry.queue.FollowUp) != 1 {
		t.Fatal("malformed request removed a queue entry")
	}
	// Consuming a reply must not reopen its slot before the waiting callback exits.
	question := &pendingQuestion{sessionID: "session", args: args, result: make(chan map[string]any, 1)}
	manager.questions = map[string]*pendingQuestion{"question": question}
	delete(answer, "preview")
	if err := manager.ResolveQuestion("session", "question", result); err != nil {
		t.Fatal(err)
	}
	<-question.result
	if err := manager.ResolveQuestion("session", "question", result); err == nil {
		t.Fatal("question accepted a second reply after delivery")
	}
	permission := &pendingPermission{sessionID: "session", result: make(chan acp.RequestPermissionResponse, 1)}
	manager.permissions = map[string]*pendingPermission{"permission": permission}
	if err := manager.ResolvePermission("session", "permission", ""); err != nil {
		t.Fatal(err)
	}
	<-permission.result
	if err := manager.ResolvePermission("session", "permission", ""); err == nil || len(manager.PendingPermissions()) != 0 {
		t.Fatal("permission accepted a second reply or remained in reconnect snapshot")
	}
	manager.cancelAll(context.Background())
	if _, err := manager.entry("session"); err == nil {
		t.Fatal("shutdown admitted a new session operation")
	}
	if _, err := manager.AskQuestion("session", args); err == nil {
		t.Fatal("shutdown admitted a new question waiter")
	}
	if _, err := manager.Permission(context.Background(), acp.RequestPermissionRequest{SessionId: "session"}); err != nil || len(manager.permissions) != 0 {
		t.Fatal("shutdown retained a new permission waiter")
	}
}

func TestSessionProjectionPreservesStreamingMessageAndUsageShape(t *testing.T) {
	var published []map[string]any
	manager := &SessionManager{
		sessions:    make(map[string]*sessionEntry),
		permissions: make(map[string]*pendingPermission),
		now:         time.Now,
		publish: func(channel string, data any) {
			published = append(published, map[string]any{"channel": channel, "data": data})
		},
	}
	entry := newSessionEntry("session", "project", "/project", "", "token")
	manager.sessions["session"] = entry

	for _, text := range []string{"hel", "lo"} {
		if err := manager.applyUpdate(context.Background(), map[string]any{
			"sessionId": "session",
			"update": map[string]any{
				"sessionUpdate": "agent_message_chunk",
				"content":       map[string]any{"type": "text", "text": text},
			},
		}, false); err != nil {
			t.Fatal(err)
		}
	}
	if err := manager.applyUpdate(context.Background(), map[string]any{
		"sessionId": "session",
		"update": map[string]any{
			"sessionUpdate": "message_usage",
			"usage":         map[string]any{"inputTokens": float64(3), "outputTokens": float64(2), "cost": 0.01},
		},
	}, true); err != nil {
		t.Fatal(err)
	}

	entry.state.Lock()
	if len(entry.messages) != 1 {
		t.Fatalf("messages: %#v", entry.messages)
	}
	message := mapValue(entry.messages[0])
	content := arrayValue(message["content"])
	if len(content) != 1 || textValue(mapValue(content[0])["text"]) != "hello" {
		t.Fatalf("content: %#v", content)
	}
	if entry.stats.Tokens.Total != 5 || entry.stats.Cost != 0.01 {
		t.Fatalf("stats: %#v", entry.stats)
	}
	if len(published) != 3 || published[0]["channel"] != "agent.event" {
		t.Fatalf("published: %#v", published)
	}
	entry.state.Unlock()
	before, err := manager.Stats("session")
	if err != nil {
		t.Fatal(err)
	}
	if !before.Reported["input"] || !before.Reported["output"] || !before.Reported["total"] || !before.Reported["cost"] || before.Reported["cacheRead"] {
		t.Fatalf("missing reported/estimated distinction: %#v", before.Reported)
	}
	for _, update := range []map[string]any{
		{"sessionUpdate": "message_usage", "usage": map[string]any{"cacheReadTokens": float64(5), "totalTokens": float64(0)}},
		{"sessionUpdate": "usage_update", "used": float64(40), "contextLimit": float64(100), "accumulatedInputTokens": float64(13), "accumulatedOutputTokens": float64(2)},
	} {
		if err := manager.applyUpdate(context.Background(), map[string]any{"sessionId": "session", "update": update}, true); err != nil {
			t.Fatal(err)
		}
		if update["sessionUpdate"] == "message_usage" && entry.stats.Tokens.Total != 5 {
			t.Fatal("explicit zero total treated as missing")
		}
	}
	if before.Reported["cacheRead"] || entry.stats.Cost != 0.01 || entry.stats.Tokens.Total != 20 || entry.stats.ContextUsage["percent"] != float64(40) {
		t.Fatalf("usage snapshot changed or unreported cost reset: %#v, %#v", before, entry.stats)
	}
	before.Reported["forged"] = true
	if entry.stats.Reported["forged"] {
		t.Fatal("stats response exposes mutable session state")
	}

	image := map[string]any{"type": "image", "data": "AA==", "mimeType": "image/png"}
	if err := manager.applyUpdate(context.Background(), map[string]any{"sessionId": "session", "update": map[string]any{"sessionUpdate": "user_message_chunk", "content": image}}, false); err != nil {
		t.Fatal(err)
	}
	event := mapValue(mapValue(published[len(published)-1]["data"])["event"])
	if event["type"] != "message_start" || mapValue(event["message"])["role"] != "user" {
		t.Fatalf("user image projected as assistant output: %#v", event)
	}
	if err := manager.applyUpdate(context.Background(), map[string]any{"sessionId": "session", "update": map[string]any{"sessionUpdate": "user_message_chunk", "content": map[string]any{"type": "text", "text": "caption"}}}, false); err != nil {
		t.Fatal(err)
	}
	if len(arrayValue(mapValue(event["message"])["content"])) != 1 {
		t.Fatal("published message mutated after a later chunk")
	}
	entry.pendingEcho = &userEcho{images: []map[string]any{image}, matched: []bool{false}}
	if err := manager.applyUpdate(context.Background(), map[string]any{"sessionId": "session", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": image}}, false); err != nil {
		t.Fatal(err)
	}
	event = mapValue(mapValue(published[len(published)-1]["data"])["event"])
	if event["type"] != "image" || entry.pendingEcho.matched[0] {
		t.Fatal("assistant image consumed the pending user echo")
	}
	// Notifications from a disconnected SDK queue cannot contaminate a replay.
	entry.attached = 1
	entry.replay = newSessionEntry("session", "project", "/project", "", "token")
	entry.replay.attached = 2
	chunk := map[string]any{"sessionId": "session", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "fresh"}}}
	beforeEvents := len(published)
	for _, generation := range []uint64{1, 2} {
		if err := manager.applyUpdate(context.WithValue(context.Background(), connectionGenerationKey{}, generation), chunk, false); err != nil {
			t.Fatal(err)
		}
	}
	if len(entry.replay.messages) != 1 || textValue(mapValue(arrayValue(mapValue(entry.replay.messages[0])["content"])[0])["text"]) != "fresh" || len(published) != beforeEvents {
		t.Fatal("old notifications entered the replacement replay or replay emitted live events")
	}
	entry.replay = nil
	entry.attached = 2
	if _, err := manager.Permission(context.WithValue(context.Background(), connectionGenerationKey{}, uint64(1)), acp.RequestPermissionRequest{SessionId: "session"}); err != nil || len(manager.permissions) != 0 || len(published) != beforeEvents {
		t.Fatal("old connection opened a permission after replacement")
	}
}
