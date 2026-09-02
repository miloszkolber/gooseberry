package controller

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/miloszkolber/gooseberry/internal/diagnostics"
)

type statusRoundTrip func(*http.Request) (*http.Response, error)

func (f statusRoundTrip) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestRuntimeStatusReportsBoundedComponentsWithoutLeakingDiagnostics(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	policy, err := NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := NewProjects(Store{Dir: root}, policy)
	settings := NewSettings(Store{Dir: root}, nil)
	agent := NewGooseClient("", "", "test", nil)
	t.Cleanup(agent.Close)
	token := "browser-token-0123456789abcdef0123456789"
	requests := &diagnostics.RequestCounter{}
	provider := newRuntimeStatusProvider(
		diagnostics.NormalizeBuild("1.2.3", "0123456789abcdef"), requests, projects, settings, root, agent,
		AuthConfig{BrowserEnabled: true, BrowserToken: token, BrowserURL: "http://127.0.0.1:8787"},
	)
	t.Cleanup(provider.close)
	browserStatus := browserRuntimeStatus{
		Build:     diagnostics.NormalizeBuild("1.2.3", "browser-revision"),
		Readiness: browserReadiness{Ready: true},
	}
	browserStatus.Readiness.Checks.Executable = true
	browserStatus.Readiness.Checks.Config = true
	browserStatus.Readiness.Checks.ArtifactStorage = true
	browserStatus.Readiness.Checks.StateStorage = true
	browserPayload, err := json.Marshal(browserStatus)
	if err != nil {
		t.Fatal(err)
	}
	provider.browserClient.Transport = statusRoundTrip(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "http://127.0.0.1:8787/status" || request.Header.Get("Authorization") != "Bearer "+token {
			t.Fatalf("browser status authority: %s %#v", request.URL, request.Header)
		}
		if _, ok := request.Context().Deadline(); !ok {
			t.Fatal("browser status request is not bounded")
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(browserPayload))), Header: make(http.Header)}, nil
	})
	report := provider.snapshot(t.Context())
	if report.Application.State != "ready" || report.Application.Build == nil || report.Application.Build.Revision != "0123456789abcdef" {
		t.Fatalf("application status: %#v", report.Application)
	}
	if report.Agent.State != "unavailable" || report.Agent.Detail != "Agent connection is not configured." {
		t.Fatalf("agent status: %#v", report.Agent)
	}
	if report.Browser.State != "ready" || report.Browser.Build == nil || report.Browser.Build.Revision != "browser-revision" {
		t.Fatalf("browser status: %#v", report.Browser)
	}

	private := "private-browser-body /private/state " + token
	provider.browserClient.Transport = statusRoundTrip(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusBadGateway, Body: io.NopCloser(strings.NewReader(private)), Header: make(http.Header)}, nil
	})
	report = provider.snapshot(t.Context())
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if report.Browser.State != "unavailable" || report.Browser.Detail != "Browser service is unavailable." {
		t.Fatalf("degraded browser status: %#v", report.Browser)
	}
	if strings.Contains(string(encoded), private) || strings.Contains(string(encoded), token) || strings.Contains(string(encoded), root) {
		t.Fatalf("runtime status leaked private diagnostics: %s", encoded)
	}

	if err := os.Remove(filepath.Join(root, "index.html")); err != nil {
		t.Fatal(err)
	}
	report = provider.snapshot(t.Context())
	if report.Application.State != "degraded" || report.Application.Detail != "Application interface is unavailable." {
		t.Fatalf("local readiness status: %#v", report.Application)
	}
}

func TestRuntimeStatusPollingDoesNotChangeRPCMetrics(t *testing.T) {
	requests := &diagnostics.RequestCounter{}
	handler := CoreHandler{
		Requests: requests,
		RuntimeStatus: func(context.Context) runtimeStatusReport {
			return runtimeStatusReport{Application: runtimeServiceStatus{State: "ready"}}
		},
	}
	if _, err := handler.Handle(t.Context(), "runtime.status", json.RawMessage(`{}`), "client"); err != nil {
		t.Fatal(err)
	}
	if snapshot := requests.Snapshot(); snapshot.Total != 0 || snapshot.Active != 0 {
		t.Fatalf("status polling changed RPC metrics: %#v", snapshot)
	}
	if _, err := handler.Handle(t.Context(), "unknown.operation", json.RawMessage(`{}`), "client"); err == nil {
		t.Fatal("unknown operation succeeded")
	}
	if snapshot := requests.Snapshot(); snapshot.Total != 1 || snapshot.Failures != 1 || snapshot.Active != 0 {
		t.Fatalf("failed RPC metrics: %#v", snapshot)
	}
}
