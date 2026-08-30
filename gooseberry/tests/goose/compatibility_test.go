package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMethodGateRejectsRemovedRegistrationAndUnknownDynamicCalls(t *testing.T) {
	source := t.TempDir()
	controllerDir := filepath.Join(source, "controller")
	write := func(path, value string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	metadata := `{"methods":[{"method":"_goose/unstable/providers/list","requestType":"ProvidersRequest_unstable"}],"notifications":[{"method":"_goose/unstable/session/update"}]}`
	dispatch := "#[custom_method(ProvidersRequest)]"
	consumer := "package controller\nconst method = \"_goose/unstable/providers/list\"\nconst notification = \"_goose/unstable/session/update\"\n"
	metadataPath := filepath.Join(source, "crates/goose/acp-meta.json")
	dispatchPath := filepath.Join(source, "crates/goose/src/acp/server/custom_dispatch.rs")
	consumerPath := filepath.Join(controllerDir, "client.go")
	for _, scenario := range []struct {
		name, metadata, dispatch, consumer string
		fails                              bool
	}{
		{"registered", metadata, dispatch, consumer, false},
		{"removed from metadata", strings.ReplaceAll(metadata, "providers/list", "providers/removed"), dispatch, consumer, true},
		{"metadata without handler", metadata, "", consumer, true},
		{"removed notification", strings.ReplaceAll(metadata, "session/update", "session/removed"), dispatch, consumer, true},
		{"unreviewed dynamic family", metadata, dispatch, consumer + "const prefix = \"_goose/unstable/new-family/\"\n", true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			write(metadataPath, scenario.metadata)
			write(dispatchPath, scenario.dispatch)
			write(consumerPath, scenario.consumer)
			if err := checkMethods(source, controllerDir); (err != nil) != scenario.fails {
				t.Fatalf("checkMethods() = %v, want failure %v", err, scenario.fails)
			}
		})
	}
}
