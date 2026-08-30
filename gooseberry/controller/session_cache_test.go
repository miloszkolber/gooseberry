package controller

import (
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
	entry.state.Lock()
	applySessionUpdate(entry, "tool_call", map[string]any{
		"toolCallId": "late-tool",
		"rawInput":   map[string]any{"text": strings.Repeat("x", inactiveProjectionMaxBytes+1)},
	}, false)
	entry.state.Unlock()
	manager.evictLocked()
	if calls != 3 || manager.sessions["chat"] != nil {
		t.Fatal("a late notification bypassed the inactive history byte limit")
	}
}
