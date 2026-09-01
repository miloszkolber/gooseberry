package controller

import (
	"context"
	"encoding/json"
	"fmt"
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
	start := map[string]any{"sessionId": "chat", "update": summonToolStart("replayed", "delegate")}
	if err := manager.applyUpdate(context.WithValue(context.Background(), connectionGenerationKey{}, uint64(2)), start, false); err != nil {
		t.Fatal(err)
	}
	fresh := subagentToolUpdate("replayed", "child-fresh", "developer__read")
	fresh["rawOutput"] = "new output"
	update := map[string]any{"sessionId": "chat", "update": fresh}
	if err := manager.applyUpdate(context.WithValue(context.Background(), connectionGenerationKey{}, uint64(2)), update, false); err != nil {
		t.Fatal(err)
	}
	stale := subagentToolUpdate("replayed", "child-stale", "developer__write")
	stale["rawOutput"] = "stale output"
	if err := manager.applyUpdate(context.WithValue(context.Background(), connectionGenerationKey{}, uint64(1)), map[string]any{"sessionId": "chat", "update": stale}, false); err != nil {
		t.Fatal(err)
	}
	projected := entry.replay.pendingToolOutputs["replayed"]
	if len(entry.pendingToolOutputs) != 0 || projected.Raw != "new output" || len(projected.SubagentActivityEvents) != 1 || projected.SubagentActivityEvents[0].ChildSessionID != "child-fresh" {
		t.Fatal("old connection output entered a replacement replay")
	}
}

func TestPendingToolPreviewsAreSafeStableAndDetached(t *testing.T) {
	entry := newSessionEntry("chat", "project", "/project", "", "")
	applySessionUpdate(entry, "tool_call", summonToolStart("z-call", "delegate"), false)
	update := subagentToolUpdate("z-call", "child", "developer__read")
	update["rawOutput"] = map[string]any{"nested": []any{map[string]any{"value": "original"}}}
	applySessionUpdate(entry, "tool_call_update", update, false)
	applySessionUpdate(entry, "tool_call_update", map[string]any{
		"toolCallId": "a-call", "status": "in_progress", "rawOutput": "first",
	}, false)
	entry.appAttachments = map[string]appAttachmentState{
		"z-call": {attachment: AppAttachment{ToolName: "apps__show", ExtensionName: "apps", ResourceURI: "ui://apps/view"}},
		"orphan": {attachment: AppAttachment{ToolName: "private", ExtensionName: "private", ResourceURI: "ui://private/view"}},
	}

	previews := pendingToolPreviewsLocked(entry)
	if len(previews) != 2 || mapValue(previews[0])["toolCallId"] != "a-call" || mapValue(previews[1])["toolCallId"] != "z-call" {
		t.Fatalf("pending previews are not stable or bounded to live tools: %#v", previews)
	}
	zPreview := mapValue(previews[1])
	if !reflect.DeepEqual(zPreview["app"], map[string]any{"toolName": "apps__show", "extensionName": "apps", "resourceUri": "ui://apps/view"}) {
		t.Fatalf("App projection changed: %#v", zPreview["app"])
	}
	activity := mapValue(zPreview["subagentActivity"])
	activityEvent := mapValue(arrayValue(activity["events"])[0])
	if len(activityEvent) != 2 || activityEvent["childSessionId"] != "child" || activityEvent["toolName"] != "developer__read" {
		t.Fatalf("subagent projection leaked or lost fields: %#v", activityEvent)
	}
	encoded, _ := json.Marshal(previews)
	if strings.Contains(string(encoded), "not projected") || strings.Contains(string(encoded), "ui://private/view") {
		t.Fatalf("pending projection leaked internal data: %s", encoded)
	}
	mapValue(arrayValue(mapValue(zPreview["output"])["nested"])[0])["value"] = "changed"
	stored := mapValue(arrayValue(mapValue(entry.pendingToolOutputs["z-call"].Raw)["nested"])[0])["value"]
	if stored != "original" {
		t.Fatal("pending projection shares mutable output with session state")
	}
}

func TestAvailableCommandsUpdateProjectsOneBoundedSafeCatalog(t *testing.T) {
	raw := []any{
		map[string]any{
			"name":        "compact",
			"description": "Compact the conversation",
			"input":       map[string]any{"hint": "optional focus", "private": "/private/input"},
			"_meta":       map[string]any{"sourcePath": "/private/recipe.yaml"},
			"sourcePath":  "/private/source.md",
		},
		map[string]any{"name": "unsafe\u202ename"},
		map[string]any{"name": "format\u2060name"},
		map[string]any{"name": "oversized", "description": strings.Repeat("x", 2049)},
	}
	for index := 0; index < 200; index++ {
		raw = append(raw, map[string]any{"name": fmt.Sprintf("command-%03d", index)})
	}
	entry := newSessionEntry("chat", "project", "/project", "", "")
	events := applySessionUpdate(entry, "available_commands_update", map[string]any{"availableCommands": raw}, false)
	if len(events) != 1 || events[0]["type"] != "commands" {
		t.Fatalf("command event: %#v", events)
	}
	commands, ok := events[0]["commands"].([]map[string]any)
	if !ok || len(commands) != maxSlashCommands {
		t.Fatalf("bounded commands: %#v", events[0]["commands"])
	}
	encoded, _ := json.Marshal(commands)
	if len(encoded) > maxSlashCommandBytes || strings.Contains(string(encoded), "/private/") || strings.Contains(string(encoded), "unsafe") || strings.Contains(string(encoded), "format") {
		t.Fatalf("unsafe command projection: %s", encoded)
	}
	first := commands[0]
	if first["name"] != "compact" || first["inputHint"] != "optional focus" {
		t.Fatalf("standard command metadata was lost: %#v", first)
	}
	if _, exists := commands[1]["description"]; exists {
		t.Fatalf("oversized optional command field was retained: %#v", commands[1])
	}
	invalidPrefix := make([]any, maxSlashCommandCandidates)
	for index := range invalidPrefix {
		invalidPrefix[index] = map[string]any{"name": "invalid command"}
	}
	invalidPrefix = append(invalidPrefix, map[string]any{"name": "outside-bound"})
	if projected := projectSlashCommands(invalidPrefix); len(projected) != 0 {
		t.Fatalf("projector inspected candidates outside its bound: %#v", projected)
	}
	rich := make([]any, maxSlashCommands)
	for index := range rich {
		rich[index] = map[string]any{
			"name":        fmt.Sprintf("rich-%03d", index),
			"description": strings.Repeat("d", 2048),
			"input":       map[string]any{"hint": strings.Repeat("h", 512)},
		}
	}
	projectedRich := projectSlashCommands(rich)
	if len(projectedRich) != maxSlashCommands || projectedRich[len(projectedRich)-1]["description"] != nil {
		t.Fatalf("optional metadata displaced command names: count=%d last=%#v", len(projectedRich), projectedRich[len(projectedRich)-1])
	}
}

func summonToolStart(toolCallID, toolName string) map[string]any {
	return map[string]any{
		"sessionUpdate": "tool_call",
		"toolCallId":    toolCallID,
		"_meta": map[string]any{"goose": map[string]any{"toolCall": map[string]any{
			"extensionName": "summon",
			"toolName":      toolName,
		}}},
	}
}

func subagentToolUpdate(toolCallID, childSessionID, toolName string) map[string]any {
	return map[string]any{
		"sessionUpdate": "tool_call_update",
		"toolCallId":    toolCallID,
		"status":        "in_progress",
		"_meta": map[string]any{"toolNotification": map[string]any{
			"type": "message",
			"params": map[string]any{
				"level":  "info",
				"logger": "subagent:" + childSessionID,
				"data": map[string]any{
					"type":        "subagent_tool_request",
					"subagent_id": childSessionID,
					"tool_call": map[string]any{
						"name":      toolName,
						"arguments": map[string]any{"secret": "not projected"},
					},
				},
			},
		}},
	}
}

func TestSubagentActivityRequiresTrustedSummonAndStaysBounded(t *testing.T) {
	wrongExtension := summonToolStart("call", "delegate")
	mapValue(mapValue(mapValue(wrongExtension["_meta"])["goose"])["toolCall"])["extensionName"] = "other"
	wrongTool := summonToolStart("call", "discover")
	wrongTool["title"] = "delegate"
	wrongLogger := subagentToolUpdate("call", "child", "developer__read")
	mapValue(mapValue(mapValue(wrongLogger["_meta"])["toolNotification"])["params"])["logger"] = "subagent:other"
	wrongLevel := subagentToolUpdate("call", "child", "developer__read")
	mapValue(mapValue(mapValue(wrongLevel["_meta"])["toolNotification"])["params"])["level"] = "warning"
	wrongData := subagentToolUpdate("call", "child", "developer__read")
	mapValue(mapValue(mapValue(mapValue(wrongData["_meta"])["toolNotification"])["params"])["data"])["type"] = "other"
	wrongMessage := subagentToolUpdate("call", "child", "developer__read")
	mapValue(mapValue(wrongMessage["_meta"])["toolNotification"])["type"] = "live_output"

	tests := []struct {
		name   string
		start  map[string]any
		update map[string]any
		want   bool
	}{
		{name: "delegate", start: summonToolStart("call", "delegate"), update: subagentToolUpdate("call", "child", "developer__read"), want: true},
		{name: "load", start: summonToolStart("call", "load"), update: subagentToolUpdate("call", "child", "developer__read"), want: true},
		{name: "title fallback is not authority", start: map[string]any{"toolCallId": "call", "title": "delegate"}, update: subagentToolUpdate("call", "child", "developer__read")},
		{name: "other extension", start: wrongExtension, update: subagentToolUpdate("call", "child", "developer__read")},
		{name: "other actual tool", start: wrongTool, update: subagentToolUpdate("call", "child", "developer__read")},
		{name: "logger mismatch", start: summonToolStart("call", "delegate"), update: wrongLogger},
		{name: "other level", start: summonToolStart("call", "delegate"), update: wrongLevel},
		{name: "other message data", start: summonToolStart("call", "delegate"), update: wrongData},
		{name: "other notification", start: summonToolStart("call", "delegate"), update: wrongMessage},
		{name: "oversized child id", start: summonToolStart("call", "delegate"), update: subagentToolUpdate("call", strings.Repeat("x", maxSubagentActivityIdentifierBytes+1), "developer__read")},
		{name: "invalid tool name", start: summonToolStart("call", "delegate"), update: subagentToolUpdate("call", "child", "developer\x00read")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			entry := newSessionEntry("chat", "project", "/project", "", "")
			applySessionUpdate(entry, "tool_call", test.start, false)
			events := applySessionUpdate(entry, "tool_call_update", test.update, false)
			if len(events) != 1 {
				t.Fatalf("tool update emitted %d events", len(events))
			}
			activity, projected := events[0]["subagentActivity"].(map[string]any)
			if projected != test.want {
				t.Fatalf("projection=%t, want %t: %#v", projected, test.want, events[0])
			}
			if !test.want {
				return
			}
			projectedEvents := arrayValue(activity["events"])
			if len(projectedEvents) != 1 {
				t.Fatalf("projected activity: %#v", activity)
			}
			projectedEvent := mapValue(projectedEvents[0])
			if len(projectedEvent) != 2 || projectedEvent["childSessionId"] != "child" || projectedEvent["toolName"] != "developer__read" {
				t.Fatalf("projection leaked or lost fields: %#v", projectedEvent)
			}
		})
	}

	entry := newSessionEntry("chat", "project", "/project", "", "")
	applySessionUpdate(entry, "tool_call", summonToolStart("bounded", "delegate"), false)
	var latest map[string]any
	for index := 0; index < maxSubagentActivityEvents+2; index++ {
		latest = applySessionUpdate(entry, "tool_call_update", subagentToolUpdate("bounded", fmt.Sprintf("child-%02d", index), fmt.Sprintf("tool-%02d", index)), false)[0]
	}
	activity := mapValue(latest["subagentActivity"])
	activityEvents := arrayValue(activity["events"])
	if len(activityEvents) != maxSubagentActivityEvents || activity["truncated"] != true || mapValue(activityEvents[0])["childSessionId"] != "child-02" || mapValue(activityEvents[len(activityEvents)-1])["childSessionId"] != "child-33" {
		t.Fatalf("activity did not retain the latest bounded window: %#v", activity)
	}

	finished := applySessionUpdate(entry, "tool_call_update", map[string]any{"toolCallId": "bounded", "status": "completed"}, false)[0]
	finalActivity := mapValue(finished["subagentActivity"])
	historyActivity := mapValue(mapValue(entry.messages[len(entry.messages)-1])["subagentActivity"])
	if !reflect.DeepEqual(finalActivity, historyActivity) {
		t.Fatalf("completion lost activity: event %#v, history %#v", finalActivity, historyActivity)
	}
	if _, pending := entry.pendingToolOutputs["bounded"]; pending {
		t.Fatal("completed activity remained in transient output")
	}
	mapValue(arrayValue(finalActivity["events"])[0])["childSessionId"] = "mutated"
	if mapValue(arrayValue(historyActivity["events"])[0])["childSessionId"] != "child-02" {
		t.Fatal("live event and retained transcript shared mutable activity")
	}

	applySessionUpdate(entry, "tool_call", summonToolStart("bounded", "load"), false)
	reused := applySessionUpdate(entry, "tool_call_update", subagentToolUpdate("bounded", "child-new", "developer__read"), false)[0]
	reusedActivity := mapValue(reused["subagentActivity"])
	if len(arrayValue(reusedActivity["events"])) != 1 || reusedActivity["truncated"] != nil {
		t.Fatalf("reused tool id retained old activity: %#v", reusedActivity)
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
	entry.queue.FollowUp = []queuedFollowUp{{ID: randomID(), Text: "same"}, {ID: randomID(), Text: "same"}}
	manager.sessions["session"] = entry
	handler := CoreHandler{Sessions: manager}
	for _, method := range []string{"session.queueEdit", "session.queueRemove"} {
		_, err := handler.Handle(context.Background(), method, json.RawMessage(`{"sessionId":"session","lane":"followUp","index":0,"text":"edited"}`), "client")
		if err == nil || !strings.Contains(err.Error(), "reload Gooseberry") {
			t.Fatalf("old client did not receive a reload instruction: %v", err)
		}
	}
	if len(entry.queue.FollowUp) != 2 || entry.queue.FollowUp[0].Text != "same" {
		t.Fatal("a request without a revision changed the queue")
	}
	original := entry.queue.Revision
	if err := manager.RemoveQueue(context.Background(), "session", "followUp", 0, original); err != nil {
		t.Fatal(err)
	}
	if entry.queue.Revision == original || len(entry.queue.FollowUp) != 1 {
		t.Fatal("removing an entry did not advance the queue revision")
	}
	// Index and text match again, but this is a different queued message.
	if err := manager.EditQueue(context.Background(), "session", "followUp", 0, "stale edit", original); err == nil {
		t.Fatal("a stale edit replaced the next identical message")
	}
	if err := manager.RemoveQueue(context.Background(), "session", "followUp", 0, original); err == nil {
		t.Fatal("a stale removal deleted the next identical message")
	}
	revision := entry.queue.Revision
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, text := range []string{"first edit", "second edit"} {
		go func() {
			<-start
			results <- manager.EditQueue(context.Background(), "session", "followUp", 0, text, revision)
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
	entry.queue.FollowUp = []queuedFollowUp{{ID: randomID(), Text: "Keep this queued message"}}
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
	manager.shutdown(context.Background())
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
