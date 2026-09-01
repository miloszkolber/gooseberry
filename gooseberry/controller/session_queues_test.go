package controller

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func queueTestContext(key, fingerprint byte) context.Context {
	return context.WithValue(context.Background(), queueRequestIdentityContextKey{}, queueRequestIdentity{
		Key:         strings.Repeat(string(key), 64),
		Fingerprint: strings.Repeat(string(fingerprint), 64),
	})
}

func TestSessionQueuesRoundTripPreservesDurableShapes(t *testing.T) {
	queues := NewSessionQueues(Store{Dir: t.TempDir()})
	dispatch := sessionQueueState{
		Revision: "dispatch-revision",
		Steering: []string{},
		FollowUp: []queuedFollowUp{
			{ID: "queued-one", Text: "first pending"},
			{ID: "queued-two", Text: "second pending"},
		},
		Dispatch: &queuedDispatch{ID: "dispatching", Text: "possibly delivered", PreviousUserMessages: 4, Attempted: true},
		Handled: []queueOperation{
			{Key: strings.Repeat("a", 64), Fingerprint: strings.Repeat("b", 64)},
			{Key: strings.Repeat("c", 64), Fingerprint: strings.Repeat("d", 64)},
		},
	}
	blocked := sessionQueueState{
		Revision: "blocked-revision",
		Steering: []string{},
		FollowUp: []queuedFollowUp{
			{ID: "queued-three", Text: "later pending"},
		},
		Blocked: &queuedFollowUp{ID: "blocked", Text: "needs a decision"},
		Handled: []queueOperation{},
	}

	if err := queues.Save("project-one", "session-one", dispatch); err != nil {
		t.Fatal(err)
	}
	if err := queues.Save("project-two", "session-two", blocked); err != nil {
		t.Fatal(err)
	}

	records, err := queues.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 || records[0].SessionID != "session-one" || records[1].SessionID != "session-two" {
		t.Fatalf("queue records lost insertion order: %#v", records)
	}
	for _, test := range []struct {
		projectID string
		sessionID string
		want      sessionQueueState
	}{
		{"project-one", "session-one", dispatch},
		{"project-two", "session-two", blocked},
	} {
		got, found, err := queues.Get(test.projectID, test.sessionID)
		if err != nil || !found || !reflect.DeepEqual(got, test.want) {
			t.Fatalf("queue round-trip for %s: got %#v, found=%v, err=%v", test.sessionID, got, found, err)
		}
	}
}

func TestSessionQueuesFailClosedInsteadOfReplayingBackup(t *testing.T) {
	t.Run("valid backup is not an execution source", func(t *testing.T) {
		store := Store{Dir: t.TempDir()}
		queues := NewSessionQueues(store)
		first := sessionQueueState{
			Revision: "first-revision",
			Steering: []string{},
			FollowUp: []queuedFollowUp{{ID: "first", Text: "preserve me"}},
			Handled:  []queueOperation{},
		}
		second := first.clone()
		second.Revision = "second-revision"
		second.FollowUp = append(second.FollowUp, queuedFollowUp{ID: "second", Text: "newer"})
		if err := queues.Save("project", "session", first); err != nil {
			t.Fatal(err)
		}
		if err := queues.Save("project", "session", second); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(store.Dir, "session-queues.json"), []byte("broken"), 0o600); err != nil {
			t.Fatal(err)
		}

		if _, _, err := NewSessionQueues(store).Get("project", "session"); err == nil {
			t.Fatal("corrupt primary silently rolled execution state back to its backup")
		}
	})

	t.Run("both invalid", func(t *testing.T) {
		store := Store{Dir: t.TempDir()}
		queues := NewSessionQueues(store)
		state := sessionQueueState{
			Revision: "revision",
			Steering: []string{},
			FollowUp: []queuedFollowUp{{ID: "queued", Text: "do not erase"}},
			Handled:  []queueOperation{},
		}
		if err := queues.Save("project", "session", state); err != nil {
			t.Fatal(err)
		}
		state.Revision = "new-revision"
		if err := queues.Save("project", "session", state); err != nil {
			t.Fatal(err)
		}
		for name, raw := range map[string]string{
			"session-queues.json":     "broken",
			"session-queues.json.bak": `{"version":99,"engine":"goose","records":[]}`,
		} {
			if err := os.WriteFile(filepath.Join(store.Dir, name), []byte(raw), 0o600); err != nil {
				t.Fatal(err)
			}
		}

		if _, err := NewSessionQueues(store).List(); err == nil {
			t.Fatal("invalid primary and backup were treated as an empty queue store")
		}
	})
}

func TestQueueAddReplaySurvivesManagerRestart(t *testing.T) {
	queues := NewSessionQueues(Store{Dir: t.TempDir()})
	entry := newSessionEntry("session", "project", "/project", "", "token")
	entry.streaming = true // Keep this storage test independent of ACP delivery.
	manager := &SessionManager{sessions: map[string]*sessionEntry{"session": entry}, queues: queues}
	request := queueTestContext('a', 'b')
	if err := manager.Queue(request, "session", "once"); err != nil {
		t.Fatal(err)
	}

	restored, found, err := queues.Get("project", "session")
	if err != nil || !found {
		t.Fatalf("reload queued mutation: found=%v err=%v", found, err)
	}
	restartedEntry := newSessionEntry("session", "project", "/project", "", "token")
	restartedEntry.queue = restored
	restartedEntry.streaming = true
	restarted := &SessionManager{sessions: map[string]*sessionEntry{"session": restartedEntry}, queues: queues}
	if err := restarted.Queue(request, "session", "once"); err != nil {
		t.Fatalf("identical replay was not acknowledged: %v", err)
	}
	if len(restartedEntry.queue.FollowUp) != 1 || restartedEntry.queue.FollowUp[0].Text != "once" {
		t.Fatalf("identical replay duplicated the queue: %#v", restartedEntry.queue.FollowUp)
	}
	if err := restarted.Queue(queueTestContext('a', 'c'), "session", "different"); err == nil {
		t.Fatal("request identity reuse with another payload was accepted")
	}
}

func TestQueuedDispatchRecoveryClassifiesTheCrashBoundary(t *testing.T) {
	for _, test := range []struct {
		name      string
		attempted bool
		messages  []any
		followUp  bool
		blocked   bool
	}{
		{
			name:     "prepared but never attempted resumes",
			messages: []any{map[string]any{"role": "user", "content": "earlier"}},
			followUp: true,
		},
		{
			name:      "replayed user turn proves delivery",
			attempted: true,
			messages: []any{
				map[string]any{"role": "user", "content": "earlier"},
				map[string]any{"role": "user", "content": "queued"},
			},
		},
		{
			name:      "attempt without replay needs a decision",
			attempted: true,
			messages:  []any{map[string]any{"role": "user", "content": "earlier"}},
			blocked:   true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			queues := NewSessionQueues(Store{Dir: t.TempDir()})
			entry := newSessionEntry("session", "project", "/project", "", "token")
			entry.messages = test.messages
			entry.queue.Dispatch = &queuedDispatch{
				ID:                   "queued-id",
				Text:                 "queued",
				PreviousUserMessages: 1,
				Attempted:            test.attempted,
			}
			manager := &SessionManager{queues: queues}
			if err := manager.recoverQueuedDispatchLocked("session", entry); err != nil {
				t.Fatal(err)
			}
			if entry.queue.Dispatch != nil || (len(entry.queue.FollowUp) == 1) != test.followUp || (entry.queue.Blocked != nil) != test.blocked {
				t.Fatalf("wrong recovered state: %#v", entry.queue)
			}
			stored, found, err := queues.Get("project", "session")
			if err != nil || !found || !reflect.DeepEqual(stored, entry.queue) {
				t.Fatalf("recovery was not durable: found=%v err=%v stored=%#v", found, err, stored)
			}
		})
	}
}

func TestQueuedPromptSettlementKeepsUnacknowledgedFailuresRecoverable(t *testing.T) {
	for _, test := range []struct {
		name      string
		delivered bool
		blocked   bool
	}{
		{name: "no user echo", blocked: true},
		{name: "user echo observed", delivered: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			queues := NewSessionQueues(Store{Dir: t.TempDir()})
			entry := newSessionEntry("session", "project", "/project", "", "token")
			entry.queue.Dispatch = &queuedDispatch{
				ID:                   "queued-id",
				Text:                 "queued",
				PreviousUserMessages: 1,
				Attempted:            true,
			}
			manager := &SessionManager{queues: queues}
			if err := manager.settleQueuedPromptLocked("session", entry, "queued-id", test.delivered, true); err != nil {
				t.Fatal(err)
			}
			if entry.queue.Dispatch != nil || (entry.queue.Blocked != nil) != test.blocked {
				t.Fatalf("wrong settled queue: %#v", entry.queue)
			}
			stored, found, err := queues.Get("project", "session")
			if err != nil || !found || !reflect.DeepEqual(stored, entry.queue) {
				t.Fatalf("settlement was not durable: found=%v err=%v stored=%#v", found, err, stored)
			}
		})
	}
}

func TestRetryOfAttemptedDispatchRequiresAuthoritativeReplay(t *testing.T) {
	entry := newSessionEntry("session", "project", "/project", "", "token")
	entry.attached = 42
	entry.queue.Dispatch = &queuedDispatch{ID: "queued", Text: "possibly delivered", Attempted: true}
	requireQueueReplayLocked(entry)
	if entry.attached != 0 {
		t.Fatal("attempted dispatch retry reused a connection without replay")
	}
}

func TestRemoteTerminalUpdateWakesQueueRestoredBehindRunningTurn(t *testing.T) {
	entry := newSessionEntry("session", "project", "/project", "", "token")
	entry.streaming = true
	entry.queue.FollowUp = []queuedFollowUp{{ID: "queued", Text: "run after replayed turn"}}
	manager := &SessionManager{sessions: map[string]*sessionEntry{"session": entry}}
	entry.op.Lock() // Keep the scheduled worker observable before it can drain.
	if err := manager.applyUpdate(context.Background(), map[string]any{
		"sessionId": "session",
		"update": map[string]any{
			"sessionUpdate": "status_message",
			"status":        map[string]any{"type": "idle"},
		},
	}, true); err != nil {
		entry.op.Unlock()
		t.Fatal(err)
	}
	entry.state.Lock()
	woken := !entry.streaming && entry.drainScheduled
	entry.state.Unlock()
	manager.mu.Lock()
	manager.closed = true
	manager.mu.Unlock()
	entry.op.Unlock()
	manager.work.Wait()
	if !woken {
		t.Fatal("remote terminal status left the restored follow-up queue asleep")
	}
}

func TestPrepareQueueResumeRestoresOnlyRunnableOwnedSessions(t *testing.T) {
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
	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "runnable", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}
	if err := records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "blocked", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}
	queues := NewSessionQueues(store)
	runnable := newSessionQueueState()
	runnable.FollowUp = []queuedFollowUp{{ID: "queued", Text: "resume"}}
	if err := queues.Save(project.ID, "runnable", runnable); err != nil {
		t.Fatal(err)
	}
	blocked := newSessionQueueState()
	blocked.Blocked = &queuedFollowUp{ID: "uncertain", Text: "decide first"}
	if err := queues.Save(project.ID, "blocked", blocked); err != nil {
		t.Fatal(err)
	}
	manager := NewSessionManager(projects, policy, records, queues, NewObjectives(store), nil)
	targets, err := manager.prepareQueueResume()
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].sessionID != "runnable" || len(targets[0].entry.queue.FollowUp) != 1 {
		t.Fatalf("wrong startup queue targets: %#v", targets)
	}
	manager.releaseEntry(targets[0].entry)
	manager.mu.Lock()
	_, blockedLoaded := manager.sessions["blocked"]
	manager.mu.Unlock()
	if blockedLoaded {
		t.Fatal("blocked queue was loaded into the active worker set")
	}
}
