package controller

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProjectWatchesPreserveRootsAndReconcileTopology(t *testing.T) {
	mount := t.TempDir()
	first, second := filepath.Join(mount, "first"), filepath.Join(mount, "second")
	for _, path := range []string{filepath.Join(first, "existing"), second} {
		if err := os.MkdirAll(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	policy, err := NewPathPolicy([]string{mount}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := NewProjects(Store{Dir: t.TempDir()}, policy)
	var published []Project
	projects.publish = func(project Project) {
		// Notifications run after the store lock is released.
		if _, err := projects.Get(project.ID); err != nil {
			t.Error(err)
		}
		published = append(published, project)
	}
	project, err := projects.Open(first)
	if err != nil {
		t.Fatal(err)
	}
	project, err = projects.AddRoot(project.ID, second)
	if err != nil {
		t.Fatal(err)
	}
	first, second = project.Roots[0], project.Roots[1]
	git := NewGit(projects, policy)
	events := make(chan ProjectFsChanged, 64)
	watches := NewProjectWatches(projects, git, func(channel string, value any) {
		if channel == "project.fsChanged" {
			events <- value.(ProjectFsChanged)
		}
	})
	defer watches.Close()
	if started, err := watches.Ensure(project.ID); err != nil || !started {
		t.Fatalf("watch startup: %v, %v", started, err)
	}
	if started, err := watches.Ensure(project.ID); err != nil || started {
		t.Fatalf("duplicate watch: %v, %v", started, err)
	}
	write := func(root, path string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, path), []byte("changed"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	waitChanges := func(wanted ...ProjectFsChange) {
		t.Helper()
		pending := make(map[ProjectFsChange]bool)
		for _, change := range wanted {
			pending[change] = true
		}
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		for len(pending) > 0 {
			select {
			case event := <-events:
				if event.ProjectID != project.ID || len(event.Changes) > 500 {
					t.Fatalf("invalid event: %#v", event)
				}
				for _, change := range event.Changes {
					delete(pending, change)
				}
			case <-timer.C:
				t.Fatalf("missing filesystem changes: %#v", pending)
			}
		}
	}
	write(first, "same.txt")
	write(second, "same.txt")
	write(first, "existing/deep.txt")
	waitChanges(ProjectFsChange{Root: first, Path: "same.txt"}, ProjectFsChange{Root: second, Path: "same.txt"}, ProjectFsChange{Root: first, Path: "existing/deep.txt"})
	if err := os.Mkdir(filepath.Join(first, "fresh"), 0o700); err != nil {
		t.Fatal(err)
	}
	waitChanges(ProjectFsChange{Root: first, Path: "fresh"})
	write(first, "fresh/deep.txt")
	waitChanges(ProjectFsChange{Root: first, Path: "fresh/deep.txt"})
	if err := os.Rename(filepath.Join(first, "fresh"), filepath.Join(first, "moved")); err != nil {
		t.Fatal(err)
	}
	waitChanges(ProjectFsChange{Root: first, Path: "moved"})
	write(first, "moved/deep.txt")
	waitChanges(ProjectFsChange{Root: first, Path: "moved/deep.txt"})
	git.mu.Lock()
	git.cache[project.ID] = &repositoryDiscovery{roots: "fixture"}
	git.mu.Unlock()
	if err := os.Mkdir(filepath.Join(first, ".git"), 0o700); err != nil {
		t.Fatal(err)
	}
	waitChanges(ProjectFsChange{Root: first, Path: ".git"})
	git.mu.Lock()
	_, cached := git.cache[project.ID]
	git.mu.Unlock()
	if cached {
		t.Fatal("Git topology was not invalidated")
	}
	if _, err := projects.RemoveRoot(project.ID, second); err != nil {
		t.Fatal(err)
	}
	if err := watches.Reconcile(project.ID); err != nil {
		t.Fatal(err)
	}
	drain := true
	for drain {
		select {
		case <-events:
		default:
			drain = false
		}
	}
	write(second, "removed-root.txt")
	write(first, "kept-root.txt")
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	kept := false
	for !kept {
		select {
		case event := <-events:
			for _, change := range event.Changes {
				if change.Root == second {
					t.Fatal("removed root still emits events")
				}
				kept = kept || change.Root == first && change.Path == "kept-root.txt"
			}
		case <-timer.C:
			t.Fatal("reconciled root did not emit its change")
		}
	}
	watches.Stop(project.ID)
	watches.mu.Lock()
	active := len(watches.active)
	watches.mu.Unlock()
	if active != 0 || len(published) != 3 || len(published[2].Roots) != 1 {
		t.Fatal("watch stop or project publication lost a mutation")
	}
}
