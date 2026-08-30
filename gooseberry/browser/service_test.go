package browser

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testToken = "server-test-token-0123456789abcdef0123456789"

func TestEnvironmentUsesExactFixedDefaults(t *testing.T) {
	lookup := func(values map[string]string) func(string) (string, bool) {
		return func(key string) (string, bool) { value, found := values[key]; return value, found }
	}
	configuration, err := configFromEnvironment(lookup(map[string]string{}))
	if err != nil || configuration.Host != fixedHost || configuration.Port != fixedPort || configuration.Authentication {
		t.Fatalf("default configuration = %#v, %v", configuration, err)
	}
	configuration, err = configFromEnvironment(lookup(map[string]string{"GOOSEBERRY_BROWSER_HOST": "127.0.0.2", "GOOSEBERRY_BROWSER_PORT": "9000", "GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_TOKEN": testToken}))
	if err != nil || configuration.Host != "127.0.0.2" || configuration.Port != 9000 || !configuration.Authentication {
		t.Fatalf("configured environment = %#v, %v", configuration, err)
	}
	for _, values := range []map[string]string{{"GOOSEBERRY_BROWSER_AUTH": ""}, {"GOOSEBERRY_BROWSER_AUTH": "1"}, {"GOOSEBERRY_BROWSER_PORT": "0"}} {
		if _, err := configFromEnvironment(lookup(values)); err == nil {
			t.Fatalf("invalid environment accepted: %#v", values)
		}
	}
}

func testApp(t *testing.T, authentication bool) (*app, config, string) {
	t.Helper()
	root := t.TempDir()
	browser := filepath.Join(root, "fake-browser")
	configFile := filepath.Join(root, "config.json")
	script := `#!/bin/sh
shift 4
command="$1"
shift
case "$command" in
  click) printf 'failed action'; exit 7 ;;
  open) /bin/sleep 30 ;;
  back) kill -TERM $$ ;;
  forward) i=0; while [ "$i" -lt 2048 ]; do printf x; i=$((i + 1)); done > "$HOME/blob"; /bin/sleep 30 ;;
  reload) i=0; while [ "$i" -lt 2048 ]; do printf x; i=$((i + 1)); done > "$HOME/blob" ;;
  screenshot) printf 'fake-image' > "$1" ;;
  snapshot) printf 'snapshot' ;;
  close) exit 0 ;;
  *) printf '%s' "$command" ;;
esac
`
	if err := os.WriteFile(browser, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configFile, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	configuration := config{
		Host: "127.0.0.1", Port: 8787, Authentication: authentication, Token: testToken,
		ArtifactRoot: filepath.Join(root, "artifacts"), StateRoot: filepath.Join(root, "state"), AgentBrowser: browser, BrowserConfig: configFile,
		CommandTimeout: 250 * time.Millisecond, RequestTimeout: time.Second, HeadersTimeout: time.Second, KeepAlive: time.Second,
		MaxArtifactBytes: 64, MaxTotalArtifactBytes: 10, MaxStateBytes: 1024, MaxSessions: 3, MaxStateEntries: 100,
	}
	if !authentication {
		configuration.Token = ""
	}
	application, err := newApp(configuration)
	if err != nil {
		t.Fatal(err)
	}
	return application, configuration, root
}

func postBrowserRequest(t *testing.T, application http.Handler, token string, command, session string, args []string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"command": command, "session": session, "args": args})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/browser", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)
	return response
}

func responseCode(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	code, _ := body["code"].(string)
	return code
}

func TestHTTPRoutesAuthenticationAndHeaders(t *testing.T) {
	application, _, _ := testApp(t, true)
	health := httptest.NewRecorder()
	application.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health", nil))
	if health.Code != http.StatusOK || health.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("health response = %d, %#v", health.Code, health.Header())
	}
	wrongMethod := httptest.NewRecorder()
	application.ServeHTTP(wrongMethod, httptest.NewRequest(http.MethodGet, "/v1/browser", nil))
	if wrongMethod.Code != http.StatusMethodNotAllowed || wrongMethod.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("wrong-method response = %d", wrongMethod.Code)
	}
	unauthorized := postBrowserRequest(t, application, "", "snapshot", "secure", nil)
	if unauthorized.Code != http.StatusUnauthorized || responseCode(t, unauthorized) != "unauthorized" {
		t.Fatalf("unauthorized response = %d", unauthorized.Code)
	}
	unsupported := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/browser", strings.NewReader("{}"))
	request.Header.Set("Authorization", "Bearer "+testToken)
	request.Header.Set("Content-Type", "text/plain")
	application.ServeHTTP(unsupported, request)
	if unsupported.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("content type response = %d", unsupported.Code)
	}
}

func TestArtifactsQuotasAndOrdinaryFailures(t *testing.T) {
	application, configuration, root := testApp(t, true)
	failed := postBrowserRequest(t, application, testToken, "click", "healthy", []string{"#button"})
	if failed.Code != http.StatusUnprocessableEntity {
		t.Fatalf("click response = %d", failed.Code)
	}
	if snapshot := postBrowserRequest(t, application, testToken, "snapshot", "healthy", nil); snapshot.Code != http.StatusOK {
		t.Fatalf("healthy session was discarded: %d", snapshot.Code)
	} else {
		var result map[string]any
		err := json.Unmarshal(snapshot.Body.Bytes(), &result)
		_, hasArtifact := result["artifact"]
		if err != nil || hasArtifact {
			t.Fatalf("non-artifact command unexpectedly returned an artifact: %#v, %v", result, err)
		}
	}
	first := postBrowserRequest(t, application, testToken, "screenshot", "screens", []string{"screen.png"})
	if first.Code != http.StatusOK {
		t.Fatalf("screenshot response = %d: %s", first.Code, first.Body.String())
	}
	duplicate := postBrowserRequest(t, application, testToken, "screenshot", "screens", []string{"screen.png"})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate response = %d", duplicate.Code)
	}
	artifact := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/artifacts/screens/screen.png", nil)
	request.Header.Set("Authorization", "Bearer "+testToken)
	application.ServeHTTP(artifact, request)
	if artifact.Code != http.StatusOK || artifact.Body.String() != "fake-image" || artifact.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("artifact response = %d, %q", artifact.Code, artifact.Body.String())
	}
	if err := os.Symlink(filepath.Join(root, "outside.png"), filepath.Join(configuration.ArtifactRoot, "screens", "linked.png")); err != nil {
		t.Fatal(err)
	}
	linked := httptest.NewRecorder()
	linkedRequest := httptest.NewRequest(http.MethodGet, "/v1/artifacts/screens/linked.png", nil)
	linkedRequest.Header.Set("Authorization", "Bearer "+testToken)
	application.ServeHTTP(linked, linkedRequest)
	if linked.Code != http.StatusNotFound {
		t.Fatalf("symlink response = %d", linked.Code)
	}
	second := postBrowserRequest(t, application, testToken, "screenshot", "quota", []string{"two.png"})
	if second.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("global quota response = %d", second.Code)
	}
}

func TestCancellationCleansBrowserState(t *testing.T) {
	application, configuration, _ := testApp(t, false)
	request, err := validateBrowserRequest(validBody("open", "https://example.com"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := application.runBrowser(ctx, request); done <- err }()
	time.Sleep(50 * time.Millisecond)
	busy := postBrowserRequest(t, application, "", "snapshot", "smoke", nil)
	if busy.Code != http.StatusConflict || responseCode(t, busy) != "session_busy" {
		t.Fatalf("concurrent session response = %d", busy.Code)
	}
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled browser action succeeded")
	}
	if _, err := os.Stat(filepath.Join(configuration.StateRoot, "smoke")); !os.IsNotExist(err) {
		t.Fatalf("cancelled state remains: %v", err)
	}
}

func TestSignalAndStateQuotaFailuresCleanBrowserState(t *testing.T) {
	application, configuration, _ := testApp(t, false)
	signalled := postBrowserRequest(t, application, "", "back", "crashed", nil)
	if signalled.Code != http.StatusBadGateway || responseCode(t, signalled) != "child_process" {
		t.Fatalf("signal response = %d: %s", signalled.Code, signalled.Body.String())
	}
	if _, err := os.Stat(filepath.Join(configuration.StateRoot, "crashed")); !os.IsNotExist(err) {
		t.Fatalf("signal-terminated state remains: %v", err)
	}

	application.config.CommandTimeout = 2 * time.Second
	oversized := postBrowserRequest(t, application, "", "forward", "oversized", nil)
	if oversized.Code != http.StatusRequestEntityTooLarge || responseCode(t, oversized) != "quota_exceeded" {
		t.Fatalf("state quota response = %d: %s", oversized.Code, oversized.Body.String())
	}
	if _, err := os.Stat(filepath.Join(configuration.StateRoot, "oversized")); !os.IsNotExist(err) {
		t.Fatalf("oversized state remains: %v", err)
	}
	fast := postBrowserRequest(t, application, "", "reload", "fast-oversized", nil)
	if fast.Code != http.StatusRequestEntityTooLarge || responseCode(t, fast) != "quota_exceeded" {
		t.Fatalf("fast state quota response = %d: %s", fast.Code, fast.Body.String())
	}
	if _, err := os.Stat(filepath.Join(configuration.StateRoot, "fast-oversized")); !os.IsNotExist(err) {
		t.Fatalf("fast oversized state remains: %v", err)
	}
}

func TestStateEntryQuotaRejectsPathologicalBrowserState(t *testing.T) {
	application, configuration, _ := testApp(t, false)
	application.config.MaxStateBytes = 1 << 20
	application.config.MaxStateEntries = 4
	response := postBrowserRequest(t, application, "", "reload", "too-many-entries", nil)
	if response.Code != http.StatusRequestEntityTooLarge || responseCode(t, response) != "quota_exceeded" {
		t.Fatalf("state entry quota response = %d: %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(configuration.StateRoot, "too-many-entries")); !os.IsNotExist(err) {
		t.Fatalf("entry-heavy state remains: %v", err)
	}
}

func TestReadBodyBound(t *testing.T) {
	application, _, _ := testApp(t, false)
	body := io.NopCloser(strings.NewReader("{" + strings.Repeat("x", maxRequestBytes+1)))
	request := httptest.NewRequest(http.MethodPost, "/v1/browser", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge || responseCode(t, response) != "request_too_large" {
		t.Fatalf("large-body response = %d", response.Code)
	}
}
