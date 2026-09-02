package browser

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/miloszkolber/gooseberry/internal/diagnostics"
)

func TestReadinessChecksLocalPrerequisitesWithoutLaunchingBrowser(t *testing.T) {
	application, configuration, _ := testApp(t, true)
	response := httptest.NewRecorder()
	application.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("ready response = %d %s", response.Code, response.Body.String())
	}
	var ready readinessReport
	if err := json.Unmarshal(response.Body.Bytes(), &ready); err != nil || !ready.Ready || !ready.Checks.Executable || !ready.Checks.Config || !ready.Checks.ArtifactStorage || !ready.Checks.StateStorage {
		t.Fatalf("readiness = %#v, %v", ready, err)
	}
	for _, root := range []string{configuration.StateRoot, configuration.ArtifactRoot} {
		entries, err := os.ReadDir(root)
		if err != nil || len(entries) != 0 {
			t.Fatalf("readiness launched a browser session in %s: %#v, %v", root, entries, err)
		}
	}

	if err := os.Chmod(configuration.AgentBrowser, 0o600); err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	application.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusServiceUnavailable || json.Unmarshal(response.Body.Bytes(), &ready) != nil || ready.Ready || ready.Checks.Executable {
		t.Fatalf("degraded readiness = %d %#v", response.Code, ready)
	}
}

func TestStatusRequiresBrowserAuthorizationAndRedactsConfiguration(t *testing.T) {
	application, configuration, root := testApp(t, true)
	application.build = diagnostics.NormalizeBuild("2.3.4", "abcdef123456")
	application.mcpHandler = application.newMCPHandler()

	unauthorized := httptest.NewRecorder()
	application.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/status", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d %s", unauthorized.Code, unauthorized.Body.String())
	}

	request := httptest.NewRequest(http.MethodGet, "/status", nil)
	request.Header.Set("Authorization", "Bearer "+testToken)
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)
	var status statusReport
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil || response.Code != http.StatusOK || status.Build.Version != "2.3.4" || status.Build.Revision != "abcdef123456" || !status.Readiness.Ready || status.Process.Goroutines < 1 {
		t.Fatalf("status = %d %#v, %v", response.Code, status, err)
	}
	for _, secret := range []string{testToken, root, configuration.AgentBrowser, configuration.BrowserConfig, configuration.ArtifactRoot, configuration.StateRoot} {
		if strings.Contains(response.Body.String(), secret) {
			t.Fatalf("status exposed private configuration %q: %s", secret, response.Body.String())
		}
	}

	var initialized struct {
		ServerInfo struct{ Name, Version string } `json:"serverInfo"`
	}
	mcpRoundTrip(t, application, "initialize", map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "test", "version": "1"}}, &initialized)
	if initialized.ServerInfo.Name != "gooseberry-browser" || initialized.ServerInfo.Version != status.Build.Version {
		t.Fatalf("MCP build identity = %#v, status build = %#v", initialized.ServerInfo, status.Build)
	}
}

func TestBrowserCommandCounterIsSharedByHTTPAndMCP(t *testing.T) {
	application, _, _ := testApp(t, true)
	if response := postBrowserRequest(t, application, testToken, "snapshot", "shared-counter", nil); response.Code != http.StatusOK {
		t.Fatalf("HTTP command = %d %s", response.Code, response.Body.String())
	}
	var failed browserToolResult
	mcpRoundTrip(t, application, "tools/call", map[string]any{"name": "browser_command", "arguments": map[string]any{"command": "click", "session": "shared-counter", "args": []string{"#missing"}}}, &failed)
	if !failed.IsError {
		t.Fatalf("failed MCP command = %#v", failed)
	}
	snapshot := application.requests.Snapshot()
	if snapshot.Total != 2 || snapshot.Failures != 1 || snapshot.Active != 0 {
		t.Fatalf("shared command counter = %#v", snapshot)
	}

	var rejected browserToolResult
	mcpRoundTrip(t, application, "tools/call", map[string]any{"name": "browser_command", "arguments": map[string]any{"command": "eval", "session": "shared-counter"}}, &rejected)
	if !rejected.IsError || application.requests.Snapshot().Total != 2 {
		t.Fatalf("invalid request reached the command executor: %#v, %#v", rejected, application.requests.Snapshot())
	}
}
