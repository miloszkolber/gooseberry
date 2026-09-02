package workspace_test

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/miloszkolber/gooseberry/internal/persist"
	"github.com/miloszkolber/gooseberry/internal/workspace"
)

func TestProjectsAndFilesPreserveAuthorityAcrossRestart(t *testing.T) {
	mount := t.TempDir()
	root := filepath.Join(mount, "project")
	second := filepath.Join(mount, "second")
	outside := t.TempDir()
	for _, path := range []string{root, second} {
		if err := os.MkdirAll(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "visible.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}

	policy, err := workspace.NewPathPolicy([]string{mount}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := persist.Store{Dir: t.TempDir()}
	projects := workspace.NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	project, err = projects.AddRoot(project.ID, second)
	if err != nil || len(project.Roots) != 2 {
		t.Fatalf("add root: %#v, %v", project, err)
	}

	files := workspace.NewFiles(projects, policy)
	listing, err := files.ReadDir(project.ID, root, ".")
	if err != nil || len(listing.Nodes) != 1 || listing.Nodes[0].Name != "visible.txt" {
		t.Fatalf("unsafe directory listing: %#v, %v", listing, err)
	}
	content, err := files.ReadFile(project.ID, root, "visible.txt")
	if err != nil || content != "hello" {
		t.Fatalf("read file: %q, %v", content, err)
	}
	for _, path := range []string{"../second", filepath.Join(second, "elsewhere.txt"), "escape/secret.txt", "."} {
		if _, err := files.ReadFile(project.ID, root, path); err == nil {
			t.Fatalf("accepted unsafe file path %q", path)
		}
	}
	large := filepath.Join(root, "large.txt")
	file, err := os.Create(large)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(4*1024*1024 + 1); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := files.ReadFile(project.ID, root, "large.txt"); err == nil {
		t.Fatal("accepted an oversized preview")
	}

	firstName := "First name"
	if _, err := projects.Update(project.ID, &firstName, nil); err != nil {
		t.Fatal(err)
	}
	secondName := "Second name"
	if _, err := projects.Update(project.ID, &secondName, nil); err != nil {
		t.Fatal(err)
	}
	current, err := projects.Get(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	current.Roots[0] = outside
	again, err := projects.Get(project.ID)
	if err != nil || again.Roots[0] == outside || again.Name != secondName {
		t.Fatalf("caller mutated owned state: %#v, %v", again, err)
	}

	if err := os.WriteFile(filepath.Join(store.Dir, "projects.json"), []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	restarted := workspace.NewProjects(store, policy)
	recovered, err := restarted.Get(project.ID)
	if err != nil || recovered.Name != firstName || len(recovered.Roots) != 2 {
		t.Fatalf("restart did not recover the last valid backup: %#v, %v", recovered, err)
	}
	// The running owner intentionally keeps its validated snapshot. Recovery is
	// a restart boundary, not a live external-file synchronization mechanism.
	current, err = projects.Get(project.ID)
	if err != nil || current.Name != secondName {
		t.Fatalf("external state mutation displaced the live snapshot: %#v, %v", current, err)
	}
}

func TestDirectoryBrowserPaginatesAndFiltersUnsafeEntries(t *testing.T) {
	mount := t.TempDir()
	root := filepath.Join(mount, "root")
	outside := t.TempDir()
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"alpha", "beta", "gamma", ".hidden"} {
		if err := os.Mkdir(filepath.Join(root, name), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	policy, err := workspace.NewPathPolicy([]string{mount}, false)
	if err != nil {
		t.Fatal(err)
	}
	files := workspace.NewFiles(workspace.NewProjects(persist.Store{Dir: t.TempDir()}, policy), policy)

	path := root
	first, err := files.ListDirectories(workspace.DirectoryRequest{Path: &path, PageSize: 2})
	if err != nil || !first.HasMore || first.Cursor == nil || *first.Cursor != "1" {
		t.Fatalf("first page: %#v, %v", first, err)
	}
	second, err := files.ListDirectories(workspace.DirectoryRequest{Path: &path, Page: 1, PageSize: 2})
	if err != nil || second.HasMore || second.Cursor != nil {
		t.Fatalf("second page: %#v, %v", second, err)
	}
	names := make([]string, 0, len(first.Directories)+len(second.Directories))
	for _, entry := range append(first.Directories, second.Directories...) {
		names = append(names, entry.Name)
	}
	sort.Strings(names)
	if strings.Join(names, ",") != "alpha,beta,gamma" {
		t.Fatalf("hidden or escaping entries leaked into pages: %#v", names)
	}
	visible, err := files.ListDirectories(workspace.DirectoryRequest{Path: &path, PageSize: 10, IncludeHidden: true})
	if err != nil || len(visible.Directories) != 4 {
		t.Fatalf("hidden directory was not opt-in: %#v, %v", visible, err)
	}
	if _, err := files.ListDirectories(workspace.DirectoryRequest{Path: &path, Page: 100}); err == nil {
		t.Fatal("accepted an unbounded page")
	}
}

func TestBoundedPersistenceRejectsSpecialFilesWithoutBlocking(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "state")
	if err := os.WriteFile(path, []byte("safe"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := persist.ReadBoundedFile(path, 3); err == nil {
		t.Fatal("accepted an oversized regular file")
	}
	pipe := filepath.Join(directory, "pipe")
	if err := syscall.Mkfifo(pipe, 0o600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, _, err := persist.ReadBoundedFile(pipe, 4)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("accepted a named pipe")
		}
	case <-time.After(time.Second):
		t.Fatal("bounded state read blocked on a named pipe")
	}
}
