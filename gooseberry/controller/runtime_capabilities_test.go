package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRuntimeReadinessAndWelcomeExposeAgentProfile(t *testing.T) {
	tests := []struct {
		name       string
		compatible bool
		static     bool
		status     int
	}{
		{name: "compatible", compatible: true, static: true, status: http.StatusOK},
		{name: "incompatible", compatible: false, static: true, status: http.StatusServiceUnavailable},
		{name: "missing interface", compatible: true, static: false, status: http.StatusServiceUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture, requests := newGooseSetupFixture(t, false)
			root := t.TempDir()
			if test.static {
				if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("ok"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			policy, err := NewPathPolicy([]string{root}, false)
			if err != nil {
				t.Fatal(err)
			}
			runtime, err := NewRuntime(RuntimeConfig{
				Host:      "127.0.0.1",
				Port:      17312,
				DataDir:   root,
				StaticDir: root,
				GooseURL:  fixture.scope.endpoint,
				Policy:    policy,
				Getenv:    func(string) string { return "" },
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				defer cancel()
				_ = runtime.Shutdown(ctx)
			})

			type readyResult struct {
				code int
				body []byte
			}
			ready := make(chan readyResult, 1)
			go func() {
				recorder := httptest.NewRecorder()
				runtime.server.Handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://gooseberry.test/readyz", nil))
				ready <- readyResult{code: recorder.Code, body: recorder.Body.Bytes()}
			}()
			initialize := takeGooseSetup(t, requests)
			response := testGooseInitializeResponse()
			if !test.compatible {
				capabilities := response["agentCapabilities"].(map[string]any)
				capabilities["loadSession"] = false
				delete(capabilities["sessionCapabilities"].(map[string]any), "list")
			}
			initialize.respondResult(t, response)
			result := <-ready
			if result.code != test.status {
				t.Fatalf("readyz status %d, body %s", result.code, result.body)
			}
			var status map[string]any
			if err := json.Unmarshal(result.body, &status); err != nil {
				t.Fatal(err)
			}
			readyProfile := mapValue(status["agentProfile"])
			if readyProfile["name"] != "goose" || readyProfile["compatible"] != test.compatible {
				t.Fatalf("readyz profile: %#v", readyProfile)
			}
			if status["applicationReady"] != test.static {
				t.Fatalf("readyz local prerequisites: %#v", status)
			}
			if test.static && status["applicationError"] != nil || !test.static && status["applicationError"] != "Application interface is unavailable." {
				t.Fatalf("readyz local detail: %#v", status)
			}

			welcomeValue, err := runtime.socket.Welcome(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			welcome := welcomeValue.(map[string]any)
			profile, ok := welcome["agentProfile"].(AgentProfile)
			if !ok || profile.Name != "goose" || profile.Compatible != test.compatible {
				t.Fatalf("welcome profile: %#v", welcome["agentProfile"])
			}
			health := welcome["gooseStatus"].(map[string]any)
			if _, nested := health["agentProfile"]; nested {
				t.Fatalf("welcome nested agent profile in Goose health: %#v", health)
			}
		})
	}

	defaultClient := NewGooseClient("", "", "test", nil)
	defer defaultClient.Close()
	explicitClient := NewGooseClient("ws://127.0.0.1:1/acp", "", "test", nil)
	defer explicitClient.Close()
	if !defaultClient.scope.requireGoose || explicitClient.scope.requireGoose {
		t.Fatal("packaged and explicit ACP endpoints use the same agent-identity policy")
	}
	status := runtimeGooseStatus(t.Context(), defaultClient)
	if status["configured"] != false || status["reachable"] != false {
		t.Fatalf("default Goose endpoint no longer requires its secret: %#v", status)
	}
}
