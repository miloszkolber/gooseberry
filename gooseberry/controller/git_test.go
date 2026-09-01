package controller

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func gitFixture(t *testing.T) (*Git, Project, string, func(...string)) {
	t.Helper()
	repository := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", repository}, args...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}
	git("init", "-b", "main")
	git("config", "user.name", "Gooseberry test")
	git("config", "user.email", "test@gooseberry.test")
	policy, err := NewPathPolicy([]string{repository}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := NewProjects(Store{Dir: t.TempDir()}, policy)
	project, err := projects.Open(repository)
	if err != nil {
		t.Fatal(err)
	}
	service := NewGit(projects, policy)
	return service, project, repository, git
}

func TestGitLinkedWorktreeDiscoveryAndScopedPreviews(t *testing.T) {
	_, _, repository, git := gitFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	const name = "shared.txt"
	const before, committed, working = "original\n", "committed in linked worktree\n", "linked working tree\n"
	if err := os.WriteFile(filepath.Join(repository, name), []byte(before), 0o600); err != nil {
		t.Fatal(err)
	}
	git("add", name)
	git("commit", "-m", "initial")
	base := resolveCommit(ctx, repository, "HEAD")
	worktree := t.TempDir()
	git("worktree", "add", "-b", "linked", worktree)
	indirection, err := os.ReadFile(filepath.Join(worktree, ".git"))
	if err != nil || !strings.HasPrefix(string(indirection), "gitdir: ") {
		t.Fatalf("expected a linked-worktree .git file: %q, %v", indirection, err)
	}
	if err := os.WriteFile(filepath.Join(worktree, name), []byte(committed), 0o600); err != nil {
		t.Fatal(err)
	}
	git("-C", worktree, "add", name)
	git("-C", worktree, "commit", "-m", "linked change")
	commit := resolveCommit(ctx, worktree, "HEAD")
	if err := os.WriteFile(filepath.Join(worktree, name), []byte(working), 0o600); err != nil {
		t.Fatal(err)
	}
	// Both directories are admitted mounts, but this project owns only the
	// linked worktree. Shared Git metadata must not admit the primary checkout.
	policy, err := NewPathPolicy([]string{repository, worktree}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := NewProjects(Store{Dir: t.TempDir()}, policy)
	project, err := projects.Open(worktree)
	if err != nil {
		t.Fatal(err)
	}
	service := NewGit(projects, policy)
	list, err := service.ListRepositories(ctx, project.ID)
	if err != nil || !list.Complete || len(list.Warnings) != 0 || len(list.Repositories) != 1 {
		t.Fatalf("linked discovery: %#v, %v", list, err)
	}
	discovered := list.Repositories[0]
	if discovered.Root != project.Roots[0] || discovered.Head.Kind != "branch" || discovered.Head.Name != "linked" || discovered.Clean {
		t.Fatalf("linked repository identity/status: %#v", discovered)
	}
	for _, check := range []struct {
		scope    GitDiffScope
		modified string
	}{
		{GitDiffScope{Kind: "commit", SHA: commit}, committed},
		{GitDiffScope{Kind: "pinned", BaseRef: base}, working},
		{GitDiffScope{Kind: "branch", BaseRef: "refs/heads/main"}, committed},
	} {
		status, err := service.Status(ctx, project.ID, worktree, check.scope)
		if err != nil || len(status.Changes) != 1 || status.Changes[0].Path != name {
			t.Fatalf("linked %s status: %#v, %v", check.scope.Kind, status, err)
		}
		preview, err := service.DiffFile(ctx, project.ID, worktree, name, check.scope)
		if err != nil || preview.Unavailable || preview.Original != before || preview.Modified != check.modified {
			t.Fatalf("linked %s preview: %#v, %v", check.scope.Kind, preview, err)
		}
	}
	if _, err := service.DiffFile(ctx, project.ID, repository, name, GitDiffScope{}); err == nil {
		t.Fatal("linked-worktree project exposed the primary checkout")
	}
}

func TestGitPreservesOddPathsAndBoundsDiffPreviews(t *testing.T) {
	service, project, repository, git := gitFixture(t)
	name := "odd\tname\nline.txt"
	if err := os.WriteFile(filepath.Join(repository, name), []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	status, err := service.Status(context.Background(), project.ID, repository, GitDiffScope{})
	if err != nil || status.Head.Kind != "unborn" || len(status.Changes) != 1 || status.Changes[0].Path != name {
		t.Fatalf("unborn odd-path status: %#v, %v", status, err)
	}
	branches, err := service.ListBranches(context.Background(), project.ID, repository)
	if err != nil || branches.Truncated || len(branches.Branches) != 0 {
		t.Fatalf("unborn branch catalog: %#v, %v", branches, err)
	}
	_, err = service.Status(context.Background(), project.ID, repository, GitDiffScope{Kind: "branch", BaseRef: "refs/heads/main"})
	var coded *codedError
	if !errors.As(err, &coded) || coded.code != "UNBORN_HEAD" {
		t.Fatalf("unborn branch comparison: %v", err)
	}
	git("add", "--", name)
	git("commit", "-m", "initial")
	if err := os.WriteFile(filepath.Join(repository, name), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	diff, err := service.DiffFile(context.Background(), project.ID, repository, name, GitDiffScope{Kind: "uncommitted"})
	if err != nil || diff.Original != "before\n" || diff.Modified != "after\n" {
		t.Fatalf("diff: %#v, %v", diff, err)
	}
	if err := os.WriteFile(filepath.Join(repository, name), []byte(strings.Repeat("x", gitPreviewMaxBytes+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	diff, err = service.DiffFile(context.Background(), project.ID, repository, name, GitDiffScope{})
	if err != nil || !diff.Unavailable || !diff.TooLarge {
		t.Fatalf("oversized diff: %#v, %v", diff, err)
	}
	if _, err := service.DiffFile(context.Background(), project.ID, repository, "../escape", GitDiffScope{}); err == nil {
		t.Fatal("accepted a repository escape")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	first, trailing := make(chan struct{}, 1), make(chan struct{}, 1)
	defer close(first)
	defer close(trailing)
	started := make(chan int32, 4)
	var inspections atomic.Int32
	inspect := func(ctx context.Context, _ Project, _ string, _ GitDiffScope) (GitRepository, error) {
		index := inspections.Add(1)
		started <- index
		gate := first
		if index > 1 {
			gate = trailing
		}
		select {
		case <-gate:
			return GitRepository{Root: repository, Clean: index > 1}, nil
		case <-ctx.Done():
			return GitRepository{}, ctx.Err()
		}
	}
	result := make(chan GitRepository, 1)
	go func() {
		value, _ := service.sharedStatus(ctx, project, repository, GitDiffScope{}, inspect)
		result <- value
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("status inspection did not start")
	}
	for index := 0; index < 3; index++ {
		consumer, stop := context.WithTimeout(ctx, 20*time.Millisecond)
		_, err := service.sharedStatus(consumer, project, repository, GitDiffScope{}, inspect)
		stop()
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("cancelled status consumer: %v", err)
		}
	}
	if inspections.Load() != 1 {
		t.Fatal("simultaneous status consumers duplicated work")
	}
	for index := 0; index < 10; index++ {
		service.MarkDirty(project.ID, filepath.Join(repository, name))
	}
	first <- struct{}{}
	select {
	case index := <-started:
		if index != 2 {
			t.Fatal("unexpected trailing inspection")
		}
	case <-ctx.Done():
		t.Fatal("dirty status did not refresh")
	}
	for index := 0; index < 10; index++ {
		service.MarkDirty(project.ID, filepath.Join(repository, name))
	}
	trailing <- struct{}{}
	select {
	case value := <-result:
		if !value.Clean || inspections.Load() != 2 {
			t.Fatal("burst was not coalesced into one trailing refresh")
		}
	case <-ctx.Done():
		t.Fatal("status did not settle")
	}
}

func TestGitBranchComparisonUsesMergeBaseAndCommittedHead(t *testing.T) {
	service, project, repository, git := gitFixture(t)
	ctx := context.Background()
	shared, odd, submodule := "shared.txt", "odd\tname\nline.txt", "vendor/submodule"
	if err := os.WriteFile(filepath.Join(repository, shared), []byte("common\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git("add", "--", shared)
	git("commit", "-m", "common")
	common := resolveCommit(ctx, repository, "HEAD")
	git("switch", "-c", "feature")
	if err := os.WriteFile(filepath.Join(repository, shared), []byte("feature committed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, odd), []byte("odd branch content\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git("add", "--", shared, odd)
	git("update-index", "--add", "--cacheinfo", "160000,"+common+","+submodule)
	git("commit", "-m", "feature changes")
	git("switch", "main")
	if err := os.WriteFile(filepath.Join(repository, "main-only.txt"), []byte("main only\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, shared), []byte("main committed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git("add", "--", "main-only.txt", shared)
	git("commit", "-m", "main changes")
	git("update-ref", "refs/remotes/origin/main", "refs/heads/main")
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	git("switch", "feature")
	git("tag", "feature", common)
	if err := os.WriteFile(filepath.Join(repository, shared), []byte("dirty worktree\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	branches, err := service.ListBranches(ctx, project.ID, repository)
	if err != nil || branches.Truncated {
		t.Fatalf("branch catalog: %#v, %v", branches, err)
	}
	want := map[string]string{
		"refs/heads/feature":       "feature",
		"refs/heads/main":          "main",
		"refs/remotes/origin/main": "origin/main",
	}
	for _, branch := range branches.Branches {
		if expected, ok := want[branch.Ref]; ok && branch.Name == expected {
			delete(want, branch.Ref)
		}
		if branch.Ref == "refs/remotes/origin/HEAD" {
			t.Fatal("symbolic remote HEAD was listed as a branch")
		}
	}
	if len(want) != 0 {
		t.Fatalf("missing branches: %#v from %#v", want, branches)
	}

	scope := GitDiffScope{Kind: "branch", BaseRef: "refs/heads/main"}
	status, err := service.Status(ctx, project.ID, repository, scope)
	if err != nil || status.Head.Kind != "branch" || status.Head.Name != "feature" || len(status.Changes) != 3 {
		t.Fatalf("branch status: %#v, %v", status, err)
	}
	paths := map[string]bool{}
	for _, change := range status.Changes {
		paths[change.Path] = true
	}
	for _, path := range []string{shared, odd, submodule} {
		if !paths[path] {
			t.Fatalf("branch status omitted %q: %#v", path, status.Changes)
		}
	}
	if paths["main-only.txt"] {
		t.Fatalf("comparison included a base-only change instead of using merge-base: %#v", status.Changes)
	}
	preview, err := service.DiffFile(ctx, project.ID, repository, shared, scope)
	if err != nil || preview.Original != "common\n" || preview.Modified != "feature committed\n" {
		t.Fatalf("branch preview included the dirty worktree: %#v, %v", preview, err)
	}
	preview, err = service.DiffFile(ctx, project.ID, repository, submodule, scope)
	if err != nil || !preview.Unavailable || preview.Message == "" || preview.Original != "" || preview.Modified != "" {
		t.Fatalf("branch submodule preview: %#v, %v", preview, err)
	}

	var branchError *codedError
	for _, check := range []struct {
		ref  string
		code string
	}{
		{"refs/remotes/origin/HEAD", "SYMBOLIC_BRANCH"},
		{"refs/heads/missing", "UNKNOWN_BRANCH"},
		{"main", "UNKNOWN_BRANCH"},
	} {
		_, err := service.Status(ctx, project.ID, repository, GitDiffScope{Kind: "branch", BaseRef: check.ref})
		branchError = nil
		if !errors.As(err, &branchError) || branchError.code != check.code {
			t.Fatalf("branch %q: %v", check.ref, err)
		}
	}

	var updates strings.Builder
	for index := 0; index <= gitBranchLimit; index++ {
		fmt.Fprintf(&updates, "create refs/heads/catalog/%03d %s\n", index, common)
	}
	command := exec.Command("git", "-C", repository, "update-ref", "--stdin")
	command.Stdin = strings.NewReader(updates.String())
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("create branch catalog: %v: %s", err, output)
	}
	branches, err = service.ListBranches(ctx, project.ID, repository)
	if err != nil || !branches.Truncated || len(branches.Branches) != gitBranchLimit {
		t.Fatalf("bounded branch catalog: %d, truncated=%v, %v", len(branches.Branches), branches.Truncated, err)
	}

	if err := os.WriteFile(filepath.Join(repository, shared), []byte("feature committed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git("switch", "--orphan", "unrelated")
	git("rm", "-rf", "--ignore-unmatch", ".")
	if err := os.WriteFile(filepath.Join(repository, "unrelated.txt"), []byte("unrelated\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git("add", "--", "unrelated.txt")
	git("commit", "-m", "unrelated")
	_, err = service.Status(ctx, project.ID, repository, scope)
	branchError = nil
	if !errors.As(err, &branchError) || branchError.code != "NO_MERGE_BASE" {
		t.Fatalf("unrelated branch comparison: %v", err)
	}
}

func TestGitRenamePreviewsAndHistoryFailures(t *testing.T) {
	service, project, repository, git := gitFixture(t)
	ctx := context.Background()
	history, err := service.ListCommits(ctx, project.ID, repository)
	if err != nil || len(history["commits"].([]GitCommit)) != 0 {
		t.Fatalf("unborn history: %#v, %v", history, err)
	}
	originalName, name := "old\tname\n[1].txt", "new\tname\n[2].txt"
	before, after := "one\ntwo\nthree\nfour\n", "one\ntwo\nthree\nchanged\n"
	if err := os.WriteFile(filepath.Join(repository, originalName), []byte(before), 0o600); err != nil {
		t.Fatal(err)
	}
	git("add", "--", originalName)
	git("commit", "-m", "initial")
	base := resolveCommit(ctx, repository, "HEAD")
	initialScope := GitDiffScope{Kind: "commit", SHA: base}
	initial, err := service.Status(ctx, project.ID, repository, initialScope)
	if err != nil || len(initial.Changes) != 1 || initial.Changes[0].Path != originalName || initial.Changes[0].Status != "added" {
		t.Fatalf("initial commit status: %#v, %v", initial, err)
	}
	initialDiff, err := service.DiffFile(ctx, project.ID, repository, originalName, initialScope)
	if err != nil || initialDiff.Original != "" || initialDiff.Modified != before {
		t.Fatalf("initial commit diff: %#v, %v", initialDiff, err)
	}
	git("mv", "--", originalName, name)
	if err := os.WriteFile(filepath.Join(repository, name), []byte(after), 0o600); err != nil {
		t.Fatal(err)
	}
	status, err := service.Status(ctx, project.ID, repository, GitDiffScope{})
	if err != nil || len(status.Changes) != 1 || status.Changes[0].OriginalPath != originalName || status.Changes[0].Path != name {
		t.Fatalf("rename status: %#v, %v", status, err)
	}
	check := func(scope GitDiffScope) {
		t.Helper()
		status, err := service.Status(ctx, project.ID, repository, scope)
		if err != nil || len(status.Changes) != 1 || status.Changes[0].OriginalPath != originalName {
			t.Fatalf("rename status (%s): %#v, %v", scope.Kind, status, err)
		}
		diff, err := service.DiffFile(ctx, project.ID, repository, name, scope)
		if err != nil || diff.Unavailable || diff.OriginalPath != originalName || diff.Original != before || diff.Modified != after {
			t.Fatalf("rename diff (%s): %#v, %v", scope.Kind, diff, err)
		}
	}
	check(GitDiffScope{Kind: "uncommitted"})
	git("add", "--", name)
	git("commit", "-m", "rename")
	check(GitDiffScope{Kind: "commit", SHA: resolveCommit(ctx, repository, "HEAD")})
	check(GitDiffScope{Kind: "pinned", BaseRef: base})
	history, err = service.ListCommits(ctx, project.ID, repository)
	if err != nil || len(history["commits"].([]GitCommit)) != 2 {
		t.Fatalf("populated history: %#v, %v", history, err)
	}
	git("update-index", "--add", "--cacheinfo", "160000,"+base+",vendor/submodule")
	git("commit", "-m", "submodule")
	submoduleScope := GitDiffScope{Kind: "commit", SHA: resolveCommit(ctx, repository, "HEAD")}
	submodule, err := service.Status(ctx, project.ID, repository, submoduleScope)
	if err != nil || len(submodule.Changes) != 1 || submodule.Changes[0].Path != "vendor/submodule" {
		t.Fatalf("submodule commit status: %#v, %v", submodule, err)
	}
	preview, err := service.DiffFile(ctx, project.ID, repository, "vendor/submodule", submoduleScope)
	if err != nil || !preview.Unavailable || preview.Message == "" || preview.Original != "" || preview.Modified != "" {
		t.Fatalf("submodule must not be rendered as a text blob: %#v, %v", preview, err)
	}
	if err := os.WriteFile(filepath.Join(repository, ".git", "refs", "heads", "main"), []byte(strings.Repeat("1", 40)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	history, err = service.ListCommits(ctx, project.ID, repository)
	var coded *codedError
	if !errors.As(err, &coded) || coded.code != "GIT_LOG_UNAVAILABLE" || history != nil {
		t.Fatalf("broken history must not appear empty: %#v, %v", history, err)
	}
}

func TestGitStatusSeparatesConcurrentScopes(t *testing.T) {
	service, project, repository, _ := gitFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started := make(chan struct{}, 3)
	release := make(chan struct{})
	defer close(release)
	inspect := func(ctx context.Context, _ Project, _ string, scope GitDiffScope) (GitRepository, error) {
		started <- struct{}{}
		select {
		case <-release:
			return GitRepository{}, nil
		case <-ctx.Done():
			return GitRepository{}, ctx.Err()
		}
	}
	for _, scope := range []GitDiffScope{{Kind: "commit", SHA: "aaaa"}, {Kind: "commit", SHA: "bbbb"}, {Kind: "pinned", BaseRef: "aaaa"}} {
		go func() { _, _ = service.sharedStatus(ctx, project, repository, scope, inspect) }()
	}
	for range 3 {
		select {
		case <-started:
		case <-ctx.Done():
			t.Fatal("different scopes incorrectly shared a status read")
		}
	}
}

func TestGitUnavailablePreviewsKeepNoContent(t *testing.T) {
	service, project, repository, git := gitFixture(t)
	for name, content := range map[string]string{
		"binary": "before\x00after",
		"large":  strings.Repeat("x", gitPreviewMaxBytes+1),
	} {
		if err := os.WriteFile(filepath.Join(repository, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(repository, "directory"), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, committed := range []bool{false, true} {
		if committed {
			git("add", "binary", "large")
			git("commit", "-m", "non-text previews")
		}
		for _, name := range []string{"binary", "large", "directory", "missing"} {
			diff, err := service.DiffFile(context.Background(), project.ID, repository, name, GitDiffScope{})
			if err != nil || !diff.Unavailable || diff.Message == "" || diff.Original != "" || diff.Modified != "" || diff.Binary != (name == "binary") || diff.TooLarge != (name == "large") {
				t.Fatalf("%s preview (committed %v): %#v, %v", name, committed, diff, err)
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if preview := readBlobPreview(ctx, repository, "HEAD", "binary"); preview.issue != "unavailable" {
		t.Fatalf("failed Git read must not appear empty: %#v", preview)
	}
}

func TestGitPreviewsRejectPipesAndCrossRepositorySymlinks(t *testing.T) {
	service, project, repository, git := gitFixture(t)
	pipe := filepath.Join(repository, "pipe")
	if err := syscall.Mkfifo(pipe, 0o600); err != nil {
		t.Fatal(err)
	}
	ready := make(chan filePreview, 1)
	go func() { ready <- readWorktreePreview(pipe) }()
	select {
	case preview := <-ready:
		if preview.issue != "unavailable" {
			t.Fatalf("named pipe preview: %#v", preview)
		}
	case <-time.After(time.Second):
		// Unblock a regressed reader so the failed test does not leave it behind.
		writer, _ := os.OpenFile(pipe, os.O_RDWR|syscall.O_NONBLOCK, 0)
		if writer != nil {
			defer writer.Close()
		}
		t.Fatal("preview blocked on a named pipe")
	}
	other := t.TempDir()
	if err := os.WriteFile(filepath.Join(other, "private"), []byte("not\nfrom\nthis\nrepository\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	policy, err := NewPathPolicy([]string{repository, other}, false)
	if err != nil {
		t.Fatal(err)
	}
	service.policy = policy
	if err := os.Symlink(filepath.Join(other, "private"), filepath.Join(repository, "outside")); err != nil {
		t.Fatal(err)
	}
	status, err := service.Status(context.Background(), project.ID, repository, GitDiffScope{})
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range status.Changes {
		if change.Added != nil || change.Removed != nil {
			t.Fatalf("counted non-file or cross-repository contents: %#v", change)
		}
	}
	if _, err := service.DiffFile(context.Background(), project.ID, repository, "outside", GitDiffScope{}); err == nil {
		t.Fatal("accepted a symlink into another admitted root")
	}
	for _, name := range []string{"target-one", "target-two"} {
		if err := os.WriteFile(filepath.Join(repository, name), []byte("target contents\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	link := filepath.Join(repository, "inside")
	if err := os.Symlink("target-one", link); err != nil {
		t.Fatal(err)
	}
	git("add", "inside", "target-one", "target-two")
	git("commit", "-m", "link")
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target-two", link); err != nil {
		t.Fatal(err)
	}
	diff, err := service.DiffFile(context.Background(), project.ID, repository, "inside", GitDiffScope{})
	if err != nil || diff.Original != "target-one" || diff.Modified != "target-two" {
		t.Fatalf("symlink diff must use link text: %#v, %v", diff, err)
	}
}
