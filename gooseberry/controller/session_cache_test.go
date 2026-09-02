package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

type countedProjection struct{ calls *int }

func (p countedProjection) MarshalJSON() ([]byte, error) {
	*p.calls++
	return []byte(`{"role":"assistant","content":"small"}`), nil
}

func TestInactiveProjectionSizeReusesOnlyUnchangedHistory(t *testing.T) {
	manager := &SessionManager{sessions: make(map[string]*sessionEntry), now: time.Now}
	entry := newSessionEntry("chat", "project", "/project", "", "")
	calls := 0
	entry.messages = []any{countedProjection{&calls}}
	manager.sessions["chat"] = entry
	manager.evictLocked()
	manager.evictLocked()
	if calls != 1 || entry.inactiveBytes == 0 {
		t.Fatal("unchanged inactive history was encoded again")
	}
	acquired, err := manager.entry("chat")
	if err != nil {
		t.Fatal(err)
	}
	acquired.state.Lock()
	acquired.messages = append(acquired.messages, map[string]any{"role": "user", "content": "changed"})
	acquired.state.Unlock()
	manager.releaseEntry(acquired)
	if calls != 2 {
		t.Fatal("an operation's changed history reused an old size")
	}
	if err := manager.applyUpdate(context.Background(), map[string]any{
		"sessionId": "chat",
		"update": map[string]any{
			"sessionUpdate": "tool_call",
			"toolCallId":    "late-tool",
			"rawInput":      map[string]any{"text": strings.Repeat("x", inactiveProjectionMaxBytes+1)},
		},
	}, false); err != nil {
		t.Fatal(err)
	}
	if calls != 3 || manager.sessions["chat"] != nil {
		t.Fatal("a late notification did not immediately enforce the inactive history byte limit")
	}
}

func TestTranscriptPagesPreserveExactMessagesAndRejectStaleProjections(t *testing.T) {
	entry := newSessionEntry("chat", "project", "/project", "", "")
	for round := 0; round < 60; round++ {
		entry.messages = append(entry.messages, map[string]any{"role": "user", "content": fmt.Sprintf("message-%03d", round)})
		assistant := map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": fmt.Sprintf("answer-%03d", round)}}}
		if round == 0 {
			assistant["content"] = []any{
				map[string]any{"type": "image", "data": "exact-image", "mimeType": "image/png"},
				map[string]any{"type": "toolCall", "id": "call", "name": "developer__read", "arguments": map[string]any{"path": "odd name.txt"}},
			}
		}
		entry.messages = append(entry.messages, assistant)
		if round == 0 {
			entry.messages = append(entry.messages, map[string]any{
				"role": "toolResult", "toolCallId": "call", "content": map[string]any{"text": "exact-result"},
				"app":              map[string]any{"resourceUri": "ui://fixture/view"},
				"subagentActivity": map[string]any{"events": []any{map[string]any{"childSessionId": "child", "toolName": "developer__read"}}},
			})
		}
	}

	tail, tailPage, err := transcriptPageLocked(entry, nil)
	if err != nil || tailPage.Start <= 0 || tailPage.Total != len(entry.messages) || tailPage.ProjectionID != entry.projectionID || messageRole(entry.messages[tailPage.Start]) != "user" {
		t.Fatalf("wrong tail page: %#v, %v", tailPage, err)
	}
	if !reflect.DeepEqual(tail, entry.messages[tailPage.Start:]) {
		t.Fatal("tail page changed normalized message shapes")
	}
	before := &transcriptBefore{Index: tailPage.Start, ProjectionID: tailPage.ProjectionID}
	earlier, earlierPage, err := transcriptPageLocked(entry, before)
	if err != nil || earlierPage.Start != 0 || !reflect.DeepEqual(earlier, entry.messages[:tailPage.Start]) {
		t.Fatalf("wrong earlier page: %#v, %v", earlierPage, err)
	}
	joined := append(append([]any{}, earlier...), tail...)
	want, _ := json.Marshal(entry.messages)
	got, _ := json.Marshal(joined)
	if string(got) != string(want) || !strings.Contains(string(got), "exact-image") || !strings.Contains(string(got), "exact-result") {
		t.Fatalf("pages did not reconstruct the exact transcript: %s", got)
	}
	if _, _, err := transcriptPageLocked(entry, &transcriptBefore{Index: tailPage.Start, ProjectionID: "stale"}); err == nil || !strings.Contains(err.Error(), "history changed") {
		t.Fatalf("stale projection was accepted: %v", err)
	}
}

func TestInactiveProjectionEvictsOldestEntriesByCount(t *testing.T) {
	manager := &SessionManager{sessions: make(map[string]*sessionEntry), now: time.Now}
	base := time.Unix(1_000, 0)
	for index := 0; index < inactiveProjectionMaxCount+3; index++ {
		id := fmt.Sprintf("chat-%02d", index)
		entry := newSessionEntry(id, "project", "/project", "", "")
		entry.inactiveAt = base.Add(time.Duration(index) * time.Second)
		entry.messages = []any{map[string]any{"role": "user", "content": id}}
		manager.sessions[id] = entry
	}
	manager.evictLocked()
	if len(manager.sessions) != inactiveProjectionMaxCount || manager.sessions["chat-00"] != nil || manager.sessions["chat-01"] != nil || manager.sessions["chat-02"] != nil || manager.sessions[fmt.Sprintf("chat-%02d", inactiveProjectionMaxCount+2)] == nil {
		t.Fatalf("inactive eviction did not retain the newest %d projections", inactiveProjectionMaxCount)
	}
}
