package controller

import (
	"testing"

	"github.com/miloszkolber/gooseberry/internal/persist"
	"github.com/miloszkolber/gooseberry/internal/workspace"
)

func TestSetLeasesRestoresRememberedTitle(t *testing.T) {
	root := t.TempDir()
	store := persist.Store{Dir: t.TempDir()}
	policy, err := workspace.NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := workspace.NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "chat", CWD: root, Title: "Remembered title"}); err != nil {
		t.Fatal(err)
	}
	manager := NewSessionManager(projects, policy, records, NewSessionQueues(store), NewObjectives(store), nil)
	if err := manager.SetLeases("client", 1, []sessionLease{{ProjectID: project.ID, SessionID: "chat"}}); err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	entry := manager.sessions["chat"]
	manager.mu.Unlock()
	if entry == nil {
		t.Fatal("lease snapshot did not restore the session projection")
	}
	entry.state.Lock()
	title := entry.title
	entry.state.Unlock()
	if title != "Remembered title" {
		t.Fatalf("restored title = %q, want %q", title, "Remembered title")
	}
}
