package controller

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestReplayBoundsKeepExecutionIdentity(t *testing.T) {
	ctx := context.Background()
	cache := NewReplayCache()
	cache.maxRequests, cache.maxWeight = 1, 4
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		<-finished
	}()
	go func() {
		defer close(finished)
		value, err := cache.Run(ctx, "client", "one", "payload", func() ([]byte, error) {
			close(started)
			<-release
			return []byte("oversize"), nil
		})
		if err != nil || string(value) != "oversize" {
			t.Errorf("first result: %q, %v", value, err)
		}
	}()
	<-started
	neverExecute := func() ([]byte, error) { t.Error("duplicate executed"); return nil, nil }
	if cache.ClearClient("client") {
		t.Fatal("cleared active execution identity")
	}
	cache.Acknowledge("client", []string{"one"})
	cache.Retain("client", nil)
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := cache.Run(cancelled, "client", "one", "payload", neverExecute); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled waiter: %v", err)
	}
	if _, err := cache.Run(ctx, "client", "one", "changed", neverExecute); err == nil || !strings.Contains(err.Error(), "different payload") {
		t.Fatalf("conflicting retry: %v", err)
	}
	if _, err := cache.Run(ctx, "client", "two", "payload", neverExecute); err == nil || !strings.Contains(err.Error(), "full") {
		t.Fatalf("count overflow: %v", err)
	}
	close(release)
	<-finished
	cache.mu.Lock()
	entry := cache.clients["client"].requests["one"]
	retained := entry.result != nil || cache.clients["client"].weight != 0
	cache.mu.Unlock()
	if retained {
		t.Fatal("oversize response still retained")
	}
	if _, err := cache.Run(ctx, "client", "one", "payload", neverExecute); err == nil || !strings.Contains(err.Error(), "already executed") {
		t.Fatalf("oversize retry: %v", err)
	}
	cache.Acknowledge("client", []string{"one"})
	if value, err := cache.Run(ctx, "client", "two", "payload", func() ([]byte, error) { return []byte("fits"), nil }); err != nil || string(value) != "fits" {
		t.Fatalf("ack did not free budget: %q, %v", value, err)
	}
	if value, err := cache.Run(ctx, "client", "two", "payload", neverExecute); err != nil || string(value) != "fits" {
		t.Fatalf("retained retry: %q, %v", value, err)
	}
	cache.Retain("client", nil)
	if !cache.ClearClient("client") {
		t.Fatal("settled namespace not cleared")
	}
}
