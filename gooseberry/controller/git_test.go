package controller

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestGitPreservesOddPathsAndBoundsDiffPreviews(t *testing.T) {
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
	name := "odd\tname\nline.txt"
	if err := os.WriteFile(filepath.Join(repository, name), []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	status, err := service.Status(context.Background(), project.ID, repository)
	if err != nil || status.Head.Kind != "unborn" || len(status.Changes) != 1 || status.Changes[0].Path != name {
		t.Fatalf("unborn odd-path status: %#v, %v", status, err)
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
	inspect := func(ctx context.Context, _ Project, _ string) (GitRepository, error) {
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
	go func() { value, _ := service.sharedStatus(ctx, project, repository, inspect); result <- value }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("status inspection did not start")
	}
	for index := 0; index < 3; index++ {
		consumer, stop := context.WithTimeout(ctx, 20*time.Millisecond)
		_, err := service.sharedStatus(consumer, project, repository, inspect)
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
