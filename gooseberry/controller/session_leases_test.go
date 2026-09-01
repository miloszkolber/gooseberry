package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestSessionLeasesFollowEachBrowserAndRejectStaleSnapshots(t *testing.T) {
	root, otherRoot := t.TempDir(), t.TempDir()
	policy, err := NewPathPolicy([]string{root, otherRoot}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := Store{Dir: t.TempDir()}
	projects := NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	other, err := projects.Open(otherRoot)
	if err != nil {
		t.Fatal(err)
	}
	root, otherRoot = project.Roots[0], other.Roots[0]
	manager := NewSessionManager(projects, policy, NewSessionRecords(store), NewObjectives(store), nil)
	for _, record := range []ProjectSessionRecord{
		{SessionID: "chat", ProjectID: project.ID, CWD: root},
		{SessionID: "other", ProjectID: other.ID, CWD: otherRoot},
		{SessionID: "survivor", ProjectID: other.ID, CWD: otherRoot},
		{SessionID: "outside", ProjectID: project.ID, CWD: otherRoot},
	} {
		if err := manager.records.Record(record); err != nil {
			t.Fatal(err)
		}
	}
	shared := []sessionLease{{ProjectID: project.ID, SessionID: "chat"}}
	set := func(client string, revision uint64, leases []sessionLease) {
		t.Helper()
		if err := manager.SetLeases(client, revision, leases); err != nil {
			t.Fatal(err)
		}
	}
	set("first", 1, shared)
	set("second", 1, shared)
	entry := manager.sessions["chat"]
	if entry == nil || entry.attached != 0 {
		t.Fatal("reconnect did not restore an unhydrated association")
	}
	entry.ephemeral = true // Make the last-release eviction observable without a large fixture.
	manager.Release("chat", project.ID, root, "first")
	if manager.sessions["chat"] != entry {
		t.Fatal("one browser released another browser's open chat")
	}
	set("first", 3, nil)
	set("first", 2, shared)
	manager.mu.Lock()
	manager.retainSessionLocked("first", "chat", project.ID)
	manager.mu.Unlock()
	if len(manager.leases["first"].sessions) != 0 {
		t.Fatal("a stale snapshot or late load reopened the closed tab")
	}
	manager.ReleaseClient("second")
	if manager.sessions["chat"] != nil {
		t.Fatal("disconnected last observer retained its ephemeral projection")
	}
	set("first", 4, shared)
	if manager.sessions["chat"] == nil {
		t.Fatal("a later reopen did not reacquire the evicted session")
	}
	for _, invalid := range [][]sessionLease{
		{{ProjectID: other.ID, SessionID: "chat"}},
		{{ProjectID: project.ID, SessionID: "outside"}},
	} {
		if err := manager.SetLeases("first", 5, invalid); err == nil {
			t.Fatal("lease snapshot bypassed recorded project or path isolation")
		}
		if manager.leases["first"].revision != 4 || !manager.isLeasedLocked("chat") {
			t.Fatal("invalid snapshot partially replaced valid leases")
		}
	}
	set("second", 1, append(shared, sessionLease{ProjectID: other.ID, SessionID: "other"}))
	manager.sessions["chat"].ephemeral = true
	handler := CoreHandler{Projects: projects, Sessions: manager}
	closeRequest, _ := json.Marshal(map[string]string{"id": project.ID})
	if _, err := handler.Handle(context.Background(), "project.close", closeRequest, "first"); err != nil {
		t.Fatal(err)
	}
	if manager.sessions["chat"] != nil || manager.sessions["other"] == nil {
		t.Fatal("project close did not release only that project's observers")
	}
	set("first", 6, shared)
	if manager.sessions["chat"] != nil {
		t.Fatal("an in-flight snapshot resurrected a closed project's lease")
	}
	if _, err := projects.Open(root); err != nil {
		t.Fatal(err)
	}
	set("first", 7, shared)
	manager.ReleaseProject(project.ID)
	if manager.sessions["chat"] == nil || !manager.isLeasedLocked("chat") {
		t.Fatal("delayed close cleanup released a reopened project's newer leases")
	}
	if err := manager.records.Forget(other.ID, "other"); err != nil {
		t.Fatal(err)
	}
	delete(manager.sessions, "other")
	set("second", 2, []sessionLease{{ProjectID: other.ID, SessionID: "other"}, {ProjectID: other.ID, SessionID: "survivor"}})
	if manager.sessions["other"] != nil || manager.sessions["survivor"] == nil || len(manager.leases["second"].sessions) != 1 {
		t.Fatal("a deleted tab was resurrected or blocked another tab's reconnect")
	}
	for _, raw := range []string{`{"revision":0,"sessions":[]}`, `{"revision":1.5,"sessions":[]}`, `{"revision":1,"sessions":null}`} {
		if _, err := handler.Handle(context.Background(), "session.setLeases", json.RawMessage(raw), "malformed"); err == nil {
			t.Fatalf("accepted malformed lease snapshot: %s", raw)
		}
	}
}

func TestReleasingSessionLeasesPreservesActiveWorkAndPendingReplies(t *testing.T) {
	for _, protect := range []func(*sessionEntry){
		func(entry *sessionEntry) { entry.streaming = true },
		func(entry *sessionEntry) { entry.runID = "running" },
		func(entry *sessionEntry) { entry.queue.FollowUp = []string{"queued"} },
		func(entry *sessionEntry) { entry.queue.Steering = []string{"steer"} },
		func(entry *sessionEntry) { entry.replay = &sessionEntry{} },
		func(entry *sessionEntry) { entry.refs = 1 }, // Permission/question callbacks retain a reference.
	} {
		manager := &SessionManager{sessions: make(map[string]*sessionEntry), now: time.Now}
		entry := newSessionEntry("chat", "project", "/project", "", "")
		entry.ephemeral = true
		protect(entry)
		manager.sessions["chat"] = entry
		manager.retainSessionLocked("client", "chat", "project")
		manager.ReleaseClient("client")
		if manager.sessions["chat"] != entry {
			t.Fatal("lease cleanup evicted active work or a pending callback")
		}
	}
}

func TestClientReaperHonorsReplacementAndInflightReplay(t *testing.T) {
	server, err := NewWebSocketServer(CoreHandler{}, nil, AuthConfig{})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	arm := func() *time.Timer {
		server.mu.Lock()
		defer server.mu.Unlock()
		server.armReapLocked("client")
		timer := server.reapTimers["client"]
		timer.Stop() // Drive expiry directly; do not wait a minute in a unit test.
		return timer
	}
	old := arm()
	server.replace("client", browserSocket{})
	server.remove("client", nil)
	server.mu.Lock()
	current := server.reapTimers["client"]
	current.Stop()
	server.mu.Unlock()
	server.reapClient("client", old)
	if server.reapTimers["client"] != current {
		t.Fatal("old expiry consumed the replacement's reconnect grace")
	}
	started, finish, settled := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(settled)
		_, _ = server.replay.Run(context.Background(), "client", "pending", "same", func() ([]byte, error) {
			close(started)
			<-finish
			return []byte(`{"ok":true}`), nil
		})
	}()
	<-started
	server.reapClient("client", current)
	server.mu.Lock()
	deferred := server.reapTimers["client"]
	deferred.Stop()
	server.mu.Unlock()
	if deferred == nil || deferred == current {
		t.Fatal("in-flight replay did not defer lease cleanup")
	}
	close(finish)
	<-settled
	reaped := make(chan error, 1)
	server.ClientReaped = func(key string) {
		// Publishing also takes server.mu; cleanup must not invert session/event locks.
		if key != "client" {
			reaped <- fmt.Errorf("wrong client: %s", key)
			return
		}
		reaped <- server.Publish(context.Background(), "cleanup", nil)
	}
	go server.reapClient("client", deferred)
	select {
	case err := <-reaped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("client cleanup deadlocked while publishing")
	}
}
