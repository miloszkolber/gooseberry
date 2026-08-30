package controller

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRegularFileOpenKeepsNonblockingSafety(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preview")
	if err := os.WriteFile(path, []byte("safe"), 0o600); err != nil {
		t.Fatal(err)
	}
	file, _, err := openRegularFile(path, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, file.Fd(), syscall.F_GETFL, 0)
	if errno != 0 || flags&syscall.O_NONBLOCK == 0 {
		t.Fatalf("open could block if the checked path became a FIFO: flags=%d, %v", flags, errno)
	}
	if _, _, err := readBoundedFile(path, 3); err == nil {
		t.Fatal("accepted an oversized regular file")
	}
	pipe := filepath.Join(filepath.Dir(path), "pipe")
	if err := syscall.Mkfifo(pipe, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readBoundedFile(pipe, 4); err == nil {
		t.Fatal("accepted a named pipe")
	}
}

func TestCorePreservesStateAndPathBoundaries(t *testing.T) {
	mount := t.TempDir()
	root := filepath.Join(mount, "Project One")
	second := filepath.Join(mount, "second")
	outside := t.TempDir()
	for _, directory := range []string{root, second} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "visible.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	policy, err := NewPathPolicy([]string{mount}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := NewProjects(Store{Dir: t.TempDir()}, policy)
	projects.now = func() time.Time { return time.UnixMilli(1234) }
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if project.Slug != "project-one" || project.LastOpened != 1234 {
		t.Fatalf("unexpected project: %#v", project)
	}
	project, err = projects.AddRoot(project.ID, second)
	if err != nil || len(project.Roots) != 2 {
		t.Fatalf("add root: %#v, %v", project, err)
	}
	files := NewFiles(projects, policy)
	listing, err := files.ReadDir(project.ID, root, ".")
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Nodes) != 1 || listing.Nodes[0].Name != "visible.txt" || !listing.Complete {
		t.Fatalf("unsafe or incomplete listing: %#v", listing)
	}
	content, err := files.ReadFile(project.ID, root, "visible.txt")
	if err != nil || content != "hello" {
		t.Fatalf("read: %q, %v", content, err)
	}
	if _, err := files.ReadFile(project.ID, root, "../second"); err == nil {
		t.Fatal("accepted a lexical escape")
	}
	if _, err := files.ReadFile(project.ID, root, filepath.Join(second, "elsewhere.txt")); err == nil {
		t.Fatal("accepted an absolute path from another admitted root")
	}
	if _, err := files.ReadFile(project.ID, root, "escape/secret.txt"); err == nil {
		t.Fatal("accepted a symlink escape")
	}
	if _, err := files.ReadFile(project.ID, root, "."); err == nil {
		t.Fatal("accepted a directory as a file")
	}
	large, err := os.Create(filepath.Join(root, "large.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if err := large.Truncate(fileReadLimit + 1); err != nil {
		large.Close()
		t.Fatal(err)
	}
	large.Close()
	if _, err := files.ReadFile(project.ID, root, "large.txt"); err == nil {
		t.Fatal("accepted an oversized preview")
	}
	crowded := filepath.Join(root, "crowded")
	if err := os.MkdirAll(filepath.Join(crowded, ".git"), 0o700); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < fileListLimit; index++ {
		if err := os.WriteFile(filepath.Join(crowded, fmt.Sprintf("%04d.txt", index)), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	listing, err = files.ReadDir(project.ID, root, "crowded")
	if err != nil || !listing.Complete || len(listing.Nodes) != fileListLimit {
		t.Fatalf(".git counted against visible limit: %d, complete=%v, %v", len(listing.Nodes), listing.Complete, err)
	}
	if err := os.WriteFile(filepath.Join(crowded, "overflow.txt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	listing, err = files.ReadDir(project.ID, root, "crowded")
	if err != nil || listing.Complete || len(listing.Nodes) != fileListLimit || len(listing.Warnings) == 0 {
		t.Fatalf("listing overflow not disclosed: %d, complete=%v, %v", len(listing.Nodes), listing.Complete, err)
	}

	reloaded := NewProjects(projects.store, policy)
	got, err := reloaded.Get(project.ID)
	if err != nil || len(got.Roots) != 2 {
		t.Fatalf("reload: %#v, %v", got, err)
	}
	tooLong := strings.Repeat("😀", 51)
	if _, err := projects.Update(project.ID, &tooLong, nil); err == nil {
		t.Fatal("project name exceeded the browser's UTF-16 length limit")
	}

	// Reusing decoded JSON must not make state or path admission stale.
	got.Roots[0] = outside
	got, err = reloaded.Get(project.ID)
	if err != nil || got.Roots[0] != root {
		t.Fatalf("returned roots mutated cached state: %#v, %v", got, err)
	}
	file := filepath.Join(projects.store.Dir, "projects.json")
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	changed := strings.Replace(string(raw), "Project One", "Project Two", 1)
	if changed == string(raw) {
		t.Fatal("missing project name in fixture")
	}
	if err := os.WriteFile(file, []byte(changed), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(file, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	got, err = reloaded.Get(project.ID)
	if err != nil || got.Name != "Project Two" {
		t.Fatalf("same-size/time edit ignored: %#v, %v", got, err)
	}
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, reader := range []*Projects{reloaded, NewProjects(projects.store, policy)} {
		got, err = reader.Get(project.ID)
		if err != nil || got.Name != "Project One" {
			t.Fatalf("empty primary did not recover backup: %#v, %v", got, err)
		}
	}
	if err := os.Rename(root, root+"-moved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, root); err != nil {
		t.Fatal(err)
	}
	if _, err := reloaded.Get(project.ID); err == nil {
		t.Fatal("cached roots bypassed fresh symlink admission")
	}
}

func TestStoreFallsBackToLastValidBackup(t *testing.T) {
	directory := t.TempDir()
	store := Store{Dir: directory}
	first := []Project{{ID: "one", Name: "First", Roots: []string{"/one"}}}
	second := []Project{{ID: "two", Name: "Second", Roots: []string{"/two"}}}
	projects := NewProjects(store, nil)
	if err := projects.save(first); err != nil {
		t.Fatal(err)
	}
	if err := projects.save(second); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "projects.json"), []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	var recovered []persistedProject
	ok, err := readStore(store, "projects.json", &recovered, validateProjects)
	if err != nil || !ok || len(recovered) != 1 || recovered[0].ID != "one" {
		t.Fatalf("recovered %#v, ok=%v, err=%v", recovered, ok, err)
	}

	// A parseable but invalid primary must neither shadow nor replace a good backup.
	for _, invalid := range []string{`null`, `[{}]`, `[{"id":"bad","roots":["/bad"],"icon":"unknown"}]`} {
		if err := os.WriteFile(filepath.Join(directory, "projects.json"), []byte(invalid), 0o600); err != nil {
			t.Fatal(err)
		}
		if ok, err := readStore(store, "projects.json", &recovered, validateProjects); err != nil || !ok || recovered[0].ID != "one" {
			t.Fatalf("invalid primary displaced backup: %s, %#v, %v", invalid, recovered, err)
		}
		if err := projects.save(second); err != nil {
			t.Fatal(err)
		}
		var backup []persistedProject
		if ok, err := readStore(store, "projects.json.bak", &backup, validateProjects); err != nil || !ok || backup[0].ID != "one" {
			t.Fatalf("invalid primary poisoned backup: %#v, %v", backup, err)
		}
	}
	if err := projects.save([]Project{{ID: "invalid"}}); err == nil {
		t.Fatal("invalid replacement accepted")
	}
	if ok, err := readStore(store, "projects.json", &recovered, validateProjects); err != nil || !ok || recovered[0].ID != "two" {
		t.Fatalf("rejected write changed primary: %#v, %v", recovered, err)
	}

	// A failed decode must not leak partially decoded fields into the fallback.
	for name, raw := range map[string]string{"partial.json": `{"name":"leaked","count":"invalid"}`, "partial.json.bak": `{"count":3}`} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(raw), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	var partial struct {
		Name  string
		Count int
	}
	if ok, err := readStore(store, "partial.json", &partial, nil); err != nil || !ok || partial.Name != "" || partial.Count != 3 {
		t.Fatalf("fallback contaminated: %#v, %v", partial, err)
	}

	objectives := NewObjectives(store)
	goal := "Saved goal"
	if _, err := objectives.Update("project", "session", &goal, nil); err != nil {
		t.Fatal(err)
	}
	goal = "Newer goal"
	if _, err := objectives.Update("project", "session", &goal, nil); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		`{"version":2,"projectId":"other","sessionId":"session","goal":"wrong owner","tasks":[],"updatedAt":1}`,
		`{"version":2,"projectId":"project","sessionId":"session","tasks":[],"updatedAt":1}`,
		`{"version":2,"projectId":"project","sessionId":"session","goal":null,"tasks":[],"updatedAt":null}`,
		`{"version":2,"projectId":"project","sessionId":"session","goal":null,"tasks":null,"updatedAt":1}`,
	} {
		if err := os.WriteFile(filepath.Join(directory, objectiveName("project", "session")), []byte(invalid), 0o600); err != nil {
			t.Fatal(err)
		}
		state, err := objectives.Get("project", "session")
		if err != nil || state.Goal == nil || *state.Goal != "Saved goal" {
			t.Fatalf("objective recovery: %#v, %v", state, err)
		}
	}
	var epoch storedObjective
	if err := json.Unmarshal([]byte(`{"version":2,"projectId":"project","sessionId":"session","goal":null,"tasks":[],"updatedAt":0}`), &epoch); err != nil || validateObjective(epoch, "project", "session") != nil {
		t.Fatalf("valid zero timestamp rejected: %v", err)
	}
	// The previous persisted schema accepts every finite JSON number, not only
	// integer milliseconds. Do not discard valid state during the cutover.
	if err := json.Unmarshal([]byte(`{"version":2,"projectId":"project","sessionId":"session","goal":null,"tasks":[],"updatedAt":12.5}`), &epoch); err != nil || epoch.UpdatedAt != 12.5 || validateObjective(epoch, "project", "session") != nil {
		t.Fatalf("valid fractional objective timestamp rejected: %v", err)
	}
	if err := projects.save([]Project{{ID: "fractional", Roots: []string{"/one"}, LastOpened: 12.5}}); err != nil {
		t.Fatal(err)
	}
	if ok, err := readStore(store, "projects.json", &recovered, validateProjects); err != nil || !ok || recovered[0].LastOpened != 12.5 {
		t.Fatalf("valid fractional project timestamp discarded: %#v, %v", recovered, err)
	}

	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: "project", SessionID: "session", CWD: "/one"}); err != nil {
		t.Fatal(err)
	}
	if err := records.Record(ProjectSessionRecord{ProjectID: "project", SessionID: "second", CWD: "/two"}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "project-sessions.json"), []byte(`{"version":99,"engine":"goose","records":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if recovered, err := records.List(); err != nil || len(recovered) != 1 || recovered[0].SessionID != "session" {
		t.Fatalf("session record recovery: %#v, %v", recovered, err)
	}

	if err := os.WriteFile(filepath.Join(directory, "config.json"), []byte(`{"signet":{"enabled":true,"port":1.5,"address":5},"hiddenModels":[null,{},5,{"id":"model","provider":"vendor"},{"id":"model","provider":"vendor"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := NewSettings(store, nil).Get()
	if err != nil || !config.Signet.Enabled || config.Signet.Port != 3850 || config.Signet.Address != "127.0.0.1" || len(config.HiddenModels) != 1 {
		t.Fatalf("settings normalization: %#v, %v", config, err)
	}
	if err := writeStore(store, "config.json", defaultConfig(), nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "config.json"), []byte(`null`), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err = NewSettings(store, nil).Get()
	if err != nil || !config.Signet.Enabled || len(config.HiddenModels) != 1 {
		t.Fatalf("settings backup recovery: %#v, %v", config, err)
	}
}

func TestDecodeMountPath(t *testing.T) {
	decoded, ok := decodeMountPath(`/projects/My\040Work`)
	if !ok || decoded != "/projects/My Work" {
		t.Fatalf("decoded %q, ok=%v", decoded, ok)
	}
	if _, ok := decodeMountPath(`/bad\09x`); ok {
		t.Fatal("accepted malformed mount escape")
	}
}

func TestObjectiveUpdatesPreserveTheOtherField(t *testing.T) {
	objectives := NewObjectives(Store{Dir: t.TempDir()})
	goal := "Ship the migration"
	if _, err := objectives.Update("project", "session", &goal, nil); err != nil {
		t.Fatal(err)
	}
	tasks := []SessionTask{{ID: "one", Text: "  Keep parity  ", Status: "active"}}
	state, err := objectives.Update("project", "session", nil, &tasks)
	if err != nil {
		t.Fatal(err)
	}
	if state.Goal == nil || *state.Goal != goal || len(state.Tasks) != 1 || state.Tasks[0].Text != "Keep parity" {
		t.Fatalf("unexpected objective: %#v", state)
	}
	if err := objectives.ClearGoal("project", "session"); err != nil {
		t.Fatal(err)
	}
	state, err = objectives.Get("project", "session")
	if err != nil || state.Goal != nil || len(state.Tasks) != 1 {
		t.Fatalf("clear lost task state: %#v, %v", state, err)
	}
}
