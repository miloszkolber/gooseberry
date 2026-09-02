package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRuntimeReadinessAndWelcomeExposeAgentProfile(t *testing.T) {
	for _, compatible := range []bool{true, false} {
		t.Run(map[bool]string{true: "compatible", false: "incompatible"}[compatible], func(t *testing.T) {
			fixture, requests := newGooseSetupFixture(t, false)
			root := t.TempDir()
			policy, err := NewPathPolicy([]string{root}, false)
			if err != nil {
				t.Fatal(err)
			}
			runtime, err := NewRuntime(RuntimeConfig{
				Host:      "127.0.0.1",
				Port:      17312,
				DataDir:   root,
				StaticDir: root,
				GooseURL:  fixture.URL,
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
			if !compatible {
				capabilities := response["agentCapabilities"].(map[string]any)
				capabilities["loadSession"] = false
				delete(capabilities["sessionCapabilities"].(map[string]any), "list")
			}
			initialize.respondResult(t, response)
			result := <-ready
			expectedCode := http.StatusOK
			if !compatible {
				expectedCode = http.StatusServiceUnavailable
			}
			if result.code != expectedCode {
				t.Fatalf("readyz status %d, body %s", result.code, result.body)
			}
			var status map[string]any
			if err := json.Unmarshal(result.body, &status); err != nil {
				t.Fatal(err)
			}
			readyProfile := mapValue(status["agentProfile"])
			if readyProfile["name"] != "goose" || readyProfile["compatible"] != compatible {
				t.Fatalf("readyz profile: %#v", readyProfile)
			}

			welcomeValue, err := runtime.socket.Welcome(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			welcome := welcomeValue.(map[string]any)
			profile, ok := welcome["agentProfile"].(AgentProfile)
			if !ok || profile.Name != "goose" || profile.Compatible != compatible {
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
	if !defaultClient.requireGoose || explicitClient.requireGoose {
		t.Fatal("packaged and explicit ACP endpoints use the same agent-identity policy")
	}
	status := runtimeGooseStatus(t.Context(), defaultClient)
	if status["configured"] != false || status["reachable"] != false {
		t.Fatalf("default Goose endpoint no longer requires its secret: %#v", status)
	}
}
