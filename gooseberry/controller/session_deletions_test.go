package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestSessionDeletionJournalAcceptsOpaqueSessionIDsAndRequiresBinding(t *testing.T) {
	store := Store{Dir: t.TempDir()}
	deletions := NewSessionDeletions(store)
	opaqueSessionID := "agent/session/" + strings.Repeat("opaque", 64)
	if err := deletions.Request("project", opaqueSessionID, "goose"); err == nil {
		t.Fatal("deletion journal accepted a logical identity instead of a bound digest")
	}
	if err := deletions.Request("project", opaqueSessionID, testDeletionAgentBinding()); err != nil {
		t.Fatalf("opaque ACP session id was rejected: %v", err)
	}
	if pending, err := deletions.List(); err != nil || len(pending) != 1 || pending[0].SessionID != opaqueSessionID {
		t.Fatalf("opaque ACP session id was not preserved: %#v, %v", pending, err)
	}
	if err := deletions.Confirm("project", opaqueSessionID); err != nil {
		t.Fatal(err)
	}
	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: "project", SessionID: opaqueSessionID, CWD: "/project"}); err != nil {
		t.Fatal(err)
	}
	manager := NewSessionManager(nil, nil, records, NewSessionQueues(store), NewObjectives(store), nil)
	if err := manager.recoverDeletions(context.Background()); err != nil {
		t.Fatalf("opaque ACP session id blocked confirmed deletion recovery: %v", err)
	}
	if pending, err := deletions.List(); err != nil || len(pending) != 0 {
		t.Fatalf("opaque ACP session deletion remains pending: %#v, %v", pending, err)
	}
}

func TestConfirmedDeletionRecoveryRemovesAllStateAndRollbackGenerations(t *testing.T) {
	store := Store{Dir: t.TempDir()}
	records := NewSessionRecords(store)
	queues := NewSessionQueues(store)
	objectives := NewObjectives(store)
	for _, record := range []ProjectSessionRecord{
		{ProjectID: "project", SessionID: "delete", CWD: "/project"},
		{ProjectID: "project", SessionID: "keep", CWD: "/project"},
	} {
		if err := records.Record(record); err != nil {
			t.Fatal(err)
		}
	}
	for sessionID, text := range map[string]string{"delete": "remove queued work", "keep": "keep queued work"} {
		state := newSessionQueueState()
		state.FollowUp = []queuedFollowUp{{ID: sessionID + "-item", Text: text}}
		if err := queues.Save("project", sessionID, state); err != nil {
			t.Fatal(err)
		}
	}
	goal := "Remove this objective"
	tasks := []SessionTask{{ID: "task", Text: "Remove this task", Status: "active"}}
	if _, err := objectives.Update("project", "delete", &goal, &tasks); err != nil {
		t.Fatal(err)
	}
	goal = "Create an objective backup"
	if _, err := objectives.Update("project", "delete", &goal, nil); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(store.Dir, "extensions", "session-goals", objectiveKey("project", "delete")+".json")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{legacy, legacy + ".bak"} {
		if err := os.WriteFile(path, []byte(`{"version":1}`), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	deletions := NewSessionDeletions(store)
	if err := deletions.Request("project", "delete", testDeletionAgentBinding()); err != nil {
		t.Fatal(err)
	}
	if err := deletions.Confirm("project", "delete"); err != nil {
		t.Fatal(err)
	}

	manager := NewSessionManager(nil, nil, records, queues, objectives, nil)
	if err := manager.recoverDeletions(context.Background()); err != nil {
		t.Fatal(err)
	}

	assertOnlyKeptSessionRecord(t, filepath.Join(store.Dir, "project-sessions.json"))
	assertOnlyKeptSessionRecord(t, filepath.Join(store.Dir, "project-sessions.json.bak"))
	assertOnlyKeptQueueRecord(t, filepath.Join(store.Dir, "session-queues.json"))
	assertOnlyKeptQueueRecord(t, filepath.Join(store.Dir, "session-queues.json.bak"))
	objective, err := objectives.Get("project", "delete")
	if err != nil || objective.Goal != nil || len(objective.Tasks) != 0 {
		t.Fatalf("deleted objective survived: %#v, %v", objective, err)
	}
	current := filepath.Join(store.Dir, objectiveName("project", "delete"))
	for _, path := range []string{current, current + ".bak", legacy, legacy + ".bak"} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("deleted objective generation remains at %s: %v", path, err)
		}
	}
	if pending, err := deletions.List(); err != nil || len(pending) != 0 {
		t.Fatalf("completed deletion remains pending: %#v, %v", pending, err)
	}

	// The journal backup still describes the prior confirmed deletion. Losing
	// the empty primary must fail closed instead of replaying that old marker.
	if err := os.Remove(filepath.Join(store.Dir, "session-deletions.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := NewSessionDeletions(store).List(); err == nil {
		t.Fatal("an older deletion-journal backup became deletion authority")
	}
}

func TestDeletionRecoveryFinishesAnObjectiveCleanupFailure(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
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
	queues := NewSessionQueues(store)
	objectives := NewObjectives(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "delete", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}
	queue := newSessionQueueState()
	queue.FollowUp = []queuedFollowUp{{ID: "queued", Text: "remove queued work"}}
	if err := queues.Save(project.ID, "delete", queue); err != nil {
		t.Fatal(err)
	}
	goal := "Remove this objective"
	tasks := []SessionTask{{ID: "task", Text: "Remove this task", Status: "active"}}
	if _, err := objectives.Update(project.ID, "delete", &goal, &tasks); err != nil {
		t.Fatal(err)
	}
	goal = "Create an objective backup"
	if _, err := objectives.Update(project.ID, "delete", &goal, nil); err != nil {
		t.Fatal(err)
	}

	deleteReachedAgent := make(chan struct{}, 1)
	allowDeleteReply := make(chan struct{})
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
			}
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			result := any(map[string]any{})
			if rpc.Method == "initialize" {
				result = testGooseInitializeResponse()
			}
			if rpc.Method == "session/delete" {
				deleteReachedAgent <- struct{}{}
				<-allowDeleteReply
			}
			if writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()
	manager := NewSessionManager(projects, policy, records, queues, objectives, nil)
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", manager)
	defer client.Close()
	manager.SetClient(client)

	objectiveEntered := make(chan struct{})
	allowObjective := make(chan struct{})
	objectiveResult := make(chan error, 1)
	go func() {
		_, updateErr := manager.withObjective(ctx, project.ID, "delete", func() (SessionGoal, error) {
			close(objectiveEntered)
			<-allowObjective
			updatedGoal := "Admitted before deletion"
			return manager.objectives.Update(project.ID, "delete", &updatedGoal, nil)
		})
		objectiveResult <- updateErr
	}()
	<-objectiveEntered
	result := make(chan error, 1)
	go func() { result <- manager.Delete(ctx, project.ID, "delete", project.Roots[0]) }()
	select {
	case <-deleteReachedAgent:
		t.Fatal("delete overtook an admitted objective update")
	case <-time.After(50 * time.Millisecond):
	}
	close(allowObjective)
	if err := <-objectiveResult; err != nil {
		t.Fatal(err)
	}
	select {
	case <-deleteReachedAgent:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	objectivePath := filepath.Join(store.Dir, objectiveName(project.ID, "delete"))
	backupPath := objectivePath + ".bak"
	heldBackup := backupPath + ".held"
	if err := os.Rename(backupPath, heldBackup); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(backupPath, 0o700); err != nil {
		t.Fatal(err)
	}
	blockingFile := filepath.Join(backupPath, "block")
	if err := os.WriteFile(blockingFile, []byte("block removal"), 0o600); err != nil {
		t.Fatal(err)
	}
	close(allowDeleteReply)
	if err := <-result; err == nil || !strings.Contains(err.Error(), "remove session objective") {
		t.Fatalf("objective cleanup failure was hidden: %v", err)
	}
	pending, err := manager.deletions.List()
	if err != nil || len(pending) != 1 || pending[0].Phase != deletionConfirmed {
		t.Fatalf("partial cleanup lost its confirmed journal: %#v, %v", pending, err)
	}
	manager.mu.Lock()
	quarantined := manager.lifecycle["delete"]
	manager.mu.Unlock()
	if !quarantined {
		t.Fatal("partial deletion cleanup released the session quarantine")
	}
	if err := os.Remove(blockingFile); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(backupPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(heldBackup, backupPath); err != nil {
		t.Fatal(err)
	}

	restarted := NewSessionManager(projects, policy, NewSessionRecords(store), NewSessionQueues(store), NewObjectives(store), nil)
	if err := restarted.recoverDeletions(ctx); err != nil {
		t.Fatal(err)
	}
	if stored, err := restarted.records.List(); err != nil || len(stored) != 0 {
		t.Fatalf("recovery retained session association: %#v, %v", stored, err)
	}
	if _, found, err := restarted.queues.Get(project.ID, "delete"); err != nil || found {
		t.Fatalf("recovery retained session queue: found=%v, %v", found, err)
	}
	objective, err := restarted.objectives.Get(project.ID, "delete")
	if err != nil || objective.Goal != nil || len(objective.Tasks) != 0 {
		t.Fatalf("recovery retained objective state: %#v, %v", objective, err)
	}
	if pending, err := restarted.deletions.List(); err != nil || len(pending) != 0 {
		t.Fatalf("recovery retained deletion journal: %#v, %v", pending, err)
	}
}

func TestRequestedDeletionRecoveryChecksAgentBindingAndAcceptsMissingSession(t *testing.T) {
	t.Run("changed agent is rejected before delete", func(t *testing.T) {
		store := Store{Dir: t.TempDir()}
		manager := deletionRecoveryManager(t, store)
		var deletes atomic.Int32
		server := deletionAgentServer(t, map[string]any{
			"protocolVersion": 1,
			"agentInfo":       map[string]any{"name": "another-agent", "version": "1.0.0"},
			"agentCapabilities": map[string]any{
				"loadSession":         true,
				"sessionCapabilities": map[string]any{"list": map[string]any{}, "delete": map[string]any{}},
			},
			"authMethods": []any{},
		}, 0, &deletes)
		defer server.Close()
		client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", manager)
		defer client.Close()
		manager.SetClient(client)
		recordDeletionRequest(t, manager, client, "goose")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := manager.recoverDeletions(ctx); err == nil || !strings.Contains(err.Error(), "agent binding changed") {
			t.Fatalf("changed agent did not fail closed: %v", err)
		}
		if deletes.Load() != 0 {
			t.Fatal("requested deletion reached a different ACP agent")
		}
	})

	t.Run("unknown session completes idempotently", func(t *testing.T) {
		store := Store{Dir: t.TempDir()}
		manager := deletionRecoveryManager(t, store)
		var deletes atomic.Int32
		server := deletionAgentServer(t, testGooseInitializeResponse(), -32002, &deletes)
		defer server.Close()
		client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", manager)
		defer client.Close()
		manager.SetClient(client)
		recordDeletionRequest(t, manager, client, "goose")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := manager.recoverDeletions(ctx); err != nil {
			t.Fatal(err)
		}
		if deletes.Load() != 1 {
			t.Fatalf("delete retries: %d", deletes.Load())
		}
		if pending, err := manager.deletions.List(); err != nil || len(pending) != 0 {
			t.Fatalf("idempotent deletion remains pending: %#v, %v", pending, err)
		}
		if stored, err := manager.records.List(); err != nil || len(stored) != 0 {
			t.Fatalf("deleted association survived: %#v, %v", stored, err)
		}
	})

	t.Run("retry rejection remains pending", func(t *testing.T) {
		store := Store{Dir: t.TempDir()}
		manager := deletionRecoveryManager(t, store)
		var deletes atomic.Int32
		server := deletionAgentServer(t, testGooseInitializeResponse(), -32602, &deletes)
		defer server.Close()
		client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", manager)
		defer client.Close()
		manager.SetClient(client)
		recordDeletionRequest(t, manager, client, "goose")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := manager.recoverDeletions(ctx); err == nil || !strings.Contains(err.Error(), "resume deletion") {
			t.Fatalf("retry rejection did not fail closed: %v", err)
		}
		if deletes.Load() != 1 {
			t.Fatalf("delete retries: %d", deletes.Load())
		}
		if pending, err := manager.deletions.List(); err != nil || len(pending) != 1 || pending[0].Phase != deletionRequested {
			t.Fatalf("retry rejection lost ambiguous deletion request: %#v, %v", pending, err)
		}
		if stored, err := manager.records.List(); err != nil || len(stored) != 1 || stored[0].SessionID != "delete" {
			t.Fatalf("rejected deletion changed local state: %#v, %v", stored, err)
		}
	})

	for _, test := range []struct {
		name         string
		sourceURL    func(string) string
		sourceSecret string
		activeSecret string
	}{
		{name: "endpoint changed", sourceURL: func(active string) string { return active + "/previous" }},
		{name: "credential configuration changed", sourceURL: func(active string) string { return active }, sourceSecret: "previous-secret", activeSecret: "current-secret"},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := Store{Dir: t.TempDir()}
			manager := deletionRecoveryManager(t, store)
			var deletes atomic.Int32
			server := deletionAgentServer(t, testGooseInitializeResponse(), 0, &deletes)
			defer server.Close()
			activeURL := "ws" + strings.TrimPrefix(server.URL, "http")
			source := NewGooseClient(test.sourceURL(activeURL), test.sourceSecret, "test", nil)
			defer source.Close()
			recordDeletionRequest(t, manager, source, "goose")
			client := NewGooseClient(activeURL, test.activeSecret, "test", manager)
			defer client.Close()
			manager.SetClient(client)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := manager.recoverDeletions(ctx); err == nil || !strings.Contains(err.Error(), "agent binding changed") {
				t.Fatalf("changed deletion binding did not fail closed: %v", err)
			}
			if deletes.Load() != 0 {
				t.Fatal("requested deletion reached a differently configured ACP agent")
			}
			if pending, err := manager.deletions.List(); err != nil || len(pending) != 1 || pending[0].Phase != deletionRequested {
				t.Fatalf("binding mismatch lost deletion request: %#v, %v", pending, err)
			}
			raw, err := os.ReadFile(filepath.Join(store.Dir, "session-deletions.json"))
			if err != nil {
				t.Fatal(err)
			}
			if test.sourceSecret != "" && strings.Contains(string(raw), test.sourceSecret) {
				t.Fatal("deletion journal stored the ACP secret")
			}
		})
	}
}

func testDeletionAgentBinding() string {
	return "sha256:" + strings.Repeat("0", 64)
}

func recordDeletionRequest(t *testing.T, manager *SessionManager, client *GooseClient, identity string) {
	t.Helper()
	binding, err := client.deletionAgentBinding(identity)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.deletions.Request("project", "delete", binding); err != nil {
		t.Fatal(err)
	}
}

func deletionRecoveryManager(t *testing.T, store Store) *SessionManager {
	t.Helper()
	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: "project", SessionID: "delete", CWD: "/project"}); err != nil {
		t.Fatal(err)
	}
	return NewSessionManager(nil, nil, records, NewSessionQueues(store), NewObjectives(store), nil)
}

func deletionAgentServer(t *testing.T, initialize map[string]any, deleteErrorCode int, deletes *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
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
			}
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			reply := map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{}}
			switch rpc.Method {
			case "initialize":
				reply["result"] = initialize
			case "session/delete":
				deletes.Add(1)
				if deleteErrorCode != 0 {
					delete(reply, "result")
					reply["error"] = map[string]any{"code": deleteErrorCode, "message": "Rejected deletion"}
				}
			}
			if writeTestRPC(connection, reply) != nil {
				return
			}
		}
	}))
}

func assertOnlyKeptSessionRecord(t *testing.T, path string) {
	t.Helper()
	raw, _, err := readStoredFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored storedSessions
	if err := decodeStored(raw, &stored, validateRecords); err != nil || len(stored.Records) != 1 || stored.Records[0].SessionID != "keep" {
		t.Fatalf("session rollback generation: %#v, %v", stored, err)
	}
}

func assertOnlyKeptQueueRecord(t *testing.T, path string) {
	t.Helper()
	raw, _, err := readStoredFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored storedSessionQueues
	if err := decodeStored(raw, &stored, validateStoredQueues); err != nil || len(stored.Records) != 1 || stored.Records[0].SessionID != "keep" {
		t.Fatalf("queue rollback generation: %#v, %v", stored, err)
	}
}
