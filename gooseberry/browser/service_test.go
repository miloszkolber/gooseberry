package browser

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const testToken = "server-test-token-0123456789abcdef0123456789"

func TestShortCommandWaitsForBothOutputStreams(t *testing.T) {
	command := exec.Command("/bin/sh", "-c", "printf stdout; printf stderr >&2")
	collector := captureCommandOutput(command)
	// Hold both writer copies until the short process has exited, making the
	// old Wait-before-read ordering deterministic rather than relying on timing.
	collector.mutex.Lock()
	locked := true
	defer func() {
		if locked {
			collector.mutex.Unlock()
		}
	}()
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer command.Process.Kill()
	running := monitorCommand(command)
	deadline := time.Now().Add(time.Second)
	for !errors.Is(command.Process.Signal(syscall.Signal(0)), os.ErrProcessDone) {
		if time.Now().After(deadline) {
			t.Fatal("short child did not exit")
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case <-running.done:
		t.Fatal("Wait returned before output was collected")
	default:
	}
	collector.mutex.Unlock()
	locked = false
	if err := running.wait(); err != nil {
		t.Fatal(err)
	}
	stdout, stderr, exceeded := collector.result()
	if stdout != "stdout" || stderr != "stderr" || exceeded {
		t.Fatalf("captured output = %q, %q, exceeded=%v", stdout, stderr, exceeded)
	}
}

func TestOutputStreamsShareOneBound(t *testing.T) {
	command := exec.Command("/bin/sh", "-c", "printf '%300000s' x; printf '%300000s' y >&2")
	collector := captureCommandOutput(command)
	if err := command.Run(); err != nil {
		t.Fatal(err)
	}
	stdout, stderr, exceeded := collector.result()
	if !exceeded || len(stdout)+len(stderr) > maxProcessOutputBytes {
		t.Fatalf("unbounded capture: stdout=%d, stderr=%d, exceeded=%v", len(stdout), len(stderr), exceeded)
	}
	select {
	case <-collector.limit:
	default:
		t.Fatal("output limit did not notify the process monitor")
	}
}

func TestFailedWaitTerminatesDescendantsHoldingPipes(t *testing.T) {
	for _, exit := range []string{"0", "7"} {
		t.Run("exit-"+exit, func(t *testing.T) {
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			defer writer.Close()
			command := exec.Command("/bin/sh", "-c", "/bin/sleep 30 & exit "+exit)
			command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
			// Unlike os/exec's output pipes, this descriptor remains ours and proves
			// that the orphaned child exits rather than just losing its reader.
			command.ExtraFiles = []*os.File{writer}
			captureCommandOutput(command)
			command.WaitDelay = 20 * time.Millisecond
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			defer syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
			_ = writer.Close()
			running := monitorCommand(command)
			err = running.wait()
			if err == nil || (exit == "0" && !errors.Is(err, exec.ErrWaitDelay)) {
				t.Fatalf("unexpected inherited-pipe result: %v", err)
			}
			running.terminate()
			if err := reader.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			if _, err := reader.Read(make([]byte, 1)); !errors.Is(err, io.EOF) {
				t.Fatalf("descendant retained its pipe after termination: %v", err)
			}
		})
	}
}

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
	configuration, err = configFromEnvironment(lookup(map[string]string{"GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_TOKEN": testToken, "GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://Browser.Example:443"}))
	if err != nil || configuration.PublicOrigin != "https://browser.example" {
		t.Fatalf("canonical public origin = %q, %v", configuration.PublicOrigin, err)
	}
	for _, values := range []map[string]string{{"GOOSEBERRY_BROWSER_AUTH": ""}, {"GOOSEBERRY_BROWSER_AUTH": "1"}, {"GOOSEBERRY_BROWSER_PORT": "0"}, {"GOOSEBERRY_BROWSER_HOST": "0.0.0.0"}, {"GOOSEBERRY_BROWSER_HOST": "::"}, {"GOOSEBERRY_BROWSER_HOST": "browser.example"}, {"GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://browser.example"}, {"GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://browser.example/path"}} {
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

func newMCPRequest(t *testing.T, method string, params any) *http.Request {
	t.Helper()
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	request.Host = "127.0.0.1:8787"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("MCP-Protocol-Version", "2025-11-25")
	request.Header.Set("Authorization", "Bearer "+testToken)
	return request
}

func decodeMCPResult(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || response.Code != http.StatusOK || len(envelope.Error) > 0 {
		t.Fatalf("MCP response = %d %s (%v)", response.Code, response.Body.String(), err)
	}
	if err := json.Unmarshal(envelope.Result, target); err != nil {
		t.Fatal(err)
	}
}

func mcpRoundTrip(t *testing.T, application *app, method string, params, target any) {
	t.Helper()
	response := httptest.NewRecorder()
	application.ServeHTTP(response, newMCPRequest(t, method, params))
	decodeMCPResult(t, response, target)
}

type browserToolResult struct {
	StructuredContent map[string]any `json:"structuredContent"`
	Content           []struct{ Type, Text string }
	IsError           bool
}

func TestMCPStandardClientUsesStatelessHTTP(t *testing.T) {
	application, _, _ := testApp(t, false)
	server := httptest.NewUnstartedServer(application)
	application.config.Port = server.Listener.Addr().(*net.TCPAddr).Port
	server.Start()
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	listed, err := session.ListTools(ctx, nil)
	if err != nil || len(listed.Tools) != 2 {
		t.Fatalf("SDK tools/list = %#v, %v", listed, err)
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "browser_command", Arguments: map[string]any{"session": "standard-client", "command": "snapshot"}})
	if err != nil || result.IsError || len(result.Content) != 1 {
		t.Fatalf("SDK tools/call = %#v, %v", result, err)
	}
	if text, ok := result.Content[0].(*mcp.TextContent); !ok || !strings.Contains(text.Text, `"stdout":"snapshot"`) {
		t.Fatalf("SDK result = %#v", result)
	}
}

func TestMCPDiscoveryAndSharedExecutor(t *testing.T) {
	application, _, _ := testApp(t, true)
	var initialized struct{ ProtocolVersion, Instructions string }
	mcpRoundTrip(t, application, "initialize", map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "test", "version": "1"}}, &initialized)
	if initialized.ProtocolVersion != "2025-11-25" || !strings.Contains(initialized.Instructions, browserGuideURI) {
		t.Fatalf("initialize = %#v", initialized)
	}
	var listed struct {
		Tools []struct {
			Name        string
			InputSchema struct {
				Properties struct {
					Command struct{ Enum []string }
				}
			}
		}
	}
	mcpRoundTrip(t, application, "tools/list", map[string]any{}, &listed)
	if len(listed.Tools) != 2 {
		t.Fatalf("tools = %#v", listed)
	}
	for _, tool := range listed.Tools {
		if tool.Name == "browser_guidance" {
			continue
		}
		if tool.Name != "browser_command" || len(tool.InputSchema.Properties.Command.Enum) != len(allowedCommands) {
			t.Fatalf("browser command schema = %#v", tool)
		}
		for _, command := range tool.InputSchema.Properties.Command.Enum {
			if !allowedCommands[command] || !strings.Contains(browserGuide, "`"+command+"`") {
				t.Fatalf("undocumented or unknown command: %s", command)
			}
		}
	}
	var resource struct {
		Contents []struct{ URI, MIMEType, Text string }
	}
	mcpRoundTrip(t, application, "resources/read", map[string]any{"uri": browserGuideURI}, &resource)
	if len(resource.Contents) != 1 || resource.Contents[0].Text != browserGuide || resource.Contents[0].MIMEType != "text/markdown" {
		t.Fatalf("guide resource = %#v", resource)
	}
	var guide browserToolResult
	mcpRoundTrip(t, application, "tools/call", map[string]any{"name": "browser_guidance", "arguments": map[string]any{}}, &guide)
	if guide.IsError || len(guide.Content) != 1 || guide.Content[0].Text != browserGuide {
		t.Fatalf("guide tool = %#v", guide)
	}
	var result browserToolResult
	mcpRoundTrip(t, application, "tools/call", map[string]any{"name": "browser_command", "arguments": map[string]any{"command": "snapshot", "session": "shared"}}, &result)
	var textResult map[string]any
	if result.IsError || result.StructuredContent["stdout"] != "snapshot" || result.StructuredContent["session"] != "shared" || len(result.Content) != 1 || json.Unmarshal([]byte(result.Content[0].Text), &textResult) != nil || !reflect.DeepEqual(textResult, result.StructuredContent) {
		t.Fatalf("browser tool result = %#v", result)
	}
	legacy := postBrowserRequest(t, application, testToken, "snapshot", "shared", nil)
	var legacyResult map[string]any
	if err := json.Unmarshal(legacy.Body.Bytes(), &legacyResult); err != nil {
		t.Fatal(err)
	}
	delete(textResult, "session")
	if legacy.Code != http.StatusOK || !reflect.DeepEqual(textResult, legacyResult) {
		t.Fatalf("MCP and legacy results differ: %#v, %#v", textResult, legacyResult)
	}
	mcpRoundTrip(t, application, "tools/call", map[string]any{"name": "browser_command", "arguments": map[string]any{"command": "click", "session": "shared", "args": []string{"#button"}}}, &result)
	if !result.IsError || result.StructuredContent["code"] != "browser_failed" {
		t.Fatalf("failed browser action did not set MCP isError: %#v", result)
	}
	mcpRoundTrip(t, application, "tools/call", map[string]any{"name": "browser_command", "arguments": map[string]any{"command": "eval", "session": "shared"}}, &result)
	if !result.IsError || result.StructuredContent["outcome"] != "rejected" {
		t.Fatalf("unsupported command accepted: %#v", result)
	}
}

func TestMCPAuthenticationAndOriginBoundary(t *testing.T) {
	for _, test := range []struct {
		name, host, origin, token, publicOrigin, fetchSite string
		status                                             int
	}{
		{name: "native", token: testToken, status: http.StatusOK},
		{name: "same origin", token: testToken, origin: "http://127.0.0.1:8787", status: http.StatusOK},
		{name: "missing token", status: http.StatusUnauthorized},
		{name: "wrong token", token: "wrong", status: http.StatusUnauthorized},
		{name: "cross origin", token: testToken, origin: "https://evil.example", status: http.StatusForbidden},
		{name: "opaque origin", token: testToken, origin: "null", status: http.StatusForbidden},
		{name: "rebound host", token: testToken, host: "evil.example:8787", status: http.StatusForbidden},
		{name: "cross site", token: testToken, fetchSite: "cross-site", status: http.StatusForbidden},
		{name: "trusted proxy preserves host", token: testToken, host: "browser.example", origin: "https://browser.example", publicOrigin: "https://browser.example", status: http.StatusOK},
		{name: "trusted proxy canonical default port", token: testToken, host: "browser.example:443", origin: "https://browser.example", publicOrigin: "https://browser.example", status: http.StatusOK},
		{name: "trusted proxy internal host", token: testToken, origin: "https://browser.example", publicOrigin: "https://browser.example", status: http.StatusOK},
		{name: "proxy foreign origin", token: testToken, origin: "https://evil.example", publicOrigin: "https://browser.example", status: http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			application, _, _ := testApp(t, true)
			application.config.PublicOrigin = test.publicOrigin
			request := newMCPRequest(t, "tools/list", map[string]any{})
			request.Header.Set("Authorization", "Bearer "+test.token)
			if test.host != "" {
				request.Host = test.host
			}
			if test.origin != "" {
				request.Header.Set("Origin", test.origin)
			}
			request.Header.Set("Sec-Fetch-Site", test.fetchSite)
			response := httptest.NewRecorder()
			application.ServeHTTP(response, request)
			if response.Code != test.status || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("response = %d, %s", response.Code, response.Body.String())
			}
		})
	}
	application, _, _ := testApp(t, false)
	request := newMCPRequest(t, "tools/list", map[string]any{})
	request.Header.Del("Authorization")
	request.Header.Set("Origin", "http://127.0.0.1:8787")
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("loopback unauthenticated MCP failed: %d", response.Code)
	}
	request.Header.Add("Origin", "http://127.0.0.1:8787")
	response = httptest.NewRecorder()
	application.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("multiple origins accepted: %d", response.Code)
	}
}

func TestMCPQuotasAndArtifactsMatchLegacy(t *testing.T) {
	application, configuration, _ := testApp(t, true)
	var result browserToolResult
	mcpRoundTrip(t, application, "tools/call", map[string]any{"name": "browser_command", "arguments": map[string]any{"command": "screenshot", "session": "shared", "args": []string{"screen.png"}}}, &result)
	artifact, _ := result.StructuredContent["artifact"].(map[string]any)
	if result.IsError || artifact["url"] != "/v1/artifacts/shared/screen.png" {
		t.Fatalf("screenshot = %#v", result)
	}
	duplicate := postBrowserRequest(t, application, testToken, "screenshot", "shared", []string{"screen.png"})
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("legacy overwrote MCP artifact: %d", duplicate.Code)
	}
	mcpRoundTrip(t, application, "tools/call", map[string]any{"name": "browser_command", "arguments": map[string]any{"command": "screenshot", "session": "second", "args": []string{"two.png"}}}, &result)
	if !result.IsError || result.StructuredContent["code"] != "quota_exceeded" {
		t.Fatalf("MCP ignored shared artifact quota: %#v", result)
	}
	if response := postBrowserRequest(t, application, testToken, "close", "shared", nil); response.Code != http.StatusOK {
		t.Fatalf("legacy close failed: %d", response.Code)
	}
	if _, err := os.Stat(filepath.Join(configuration.ArtifactRoot, "shared")); !os.IsNotExist(err) {
		t.Fatalf("legacy close retained MCP artifacts: %v", err)
	}
	request := newMCPRequest(t, "tools/call", map[string]any{"name": "browser_command", "arguments": strings.Repeat("x", maxRequestBytes+1)})
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("MCP accepted oversized body: %d %s", response.Code, response.Body.String())
	}
}

func TestMCPCancellationAndShutdownCleanSharedState(t *testing.T) {
	for _, shutdown := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy client cancellation", true: "service shutdown"}[shutdown], func(t *testing.T) {
			application, configuration, _ := testApp(t, true)
			application.config.CommandTimeout = 5 * time.Second
			application.config.RequestTimeout = 5 * time.Second
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			request := newMCPRequest(t, "tools/call", map[string]any{"name": "browser_command", "arguments": map[string]any{"command": "open", "session": "shared", "args": []string{"https://example.com"}}}).WithContext(ctx)
			done := make(chan struct{})
			go func() { application.ServeHTTP(httptest.NewRecorder(), request); close(done) }()
			deadline := time.Now().Add(2 * time.Second)
			for {
				if _, err := os.Stat(filepath.Join(configuration.StateRoot, "shared", ".lock")); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("MCP browser process did not acquire shared session lock")
				}
				time.Sleep(5 * time.Millisecond)
			}
			busy := postBrowserRequest(t, application, testToken, "snapshot", "shared", nil)
			if busy.Code != http.StatusConflict || responseCode(t, busy) != "session_busy" {
				t.Fatalf("legacy request bypassed MCP lock: %d %s", busy.Code, busy.Body.String())
			}
			if shutdown {
				application.shutdown()
			} else {
				cancel()
			}
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("MCP HTTP request did not terminate")
			}
			deadline = time.Now().Add(2 * time.Second)
			for {
				application.activeMu.Lock()
				active := len(application.active)
				application.activeMu.Unlock()
				if active == 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("MCP command did not clean up after its HTTP request ended")
				}
				time.Sleep(5 * time.Millisecond)
			}
			if _, err := os.Stat(filepath.Join(configuration.StateRoot, "shared")); !os.IsNotExist(err) {
				t.Fatalf("cancelled MCP state remains: %v", err)
			}
		})
	}
}
