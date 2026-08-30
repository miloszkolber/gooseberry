package controller

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func TestHTTPAuthRequiresSameOriginAndIssuesCompatibleCookie(t *testing.T) {
	config := AuthConfig{Enabled: true, ControllerToken: "0123456789abcdef0123456789abcdef", PublicOrigin: "https://gooseberry.test"}
	handler, err := NewHTTPHandler(nil, ObjectiveHandler{}, nil, nil, config, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	login := func(origin string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/auth/login", strings.NewReader(`{"token":"0123456789abcdef0123456789abcdef"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Sec-Fetch-Site", "same-origin")
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	if response := login("https://attacker.test"); response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin login: %d", response.Code)
	}
	response := login("https://gooseberry.test")
	if response.Code != http.StatusOK || !strings.Contains(response.Header().Get("Set-Cookie"), "; Secure") {
		t.Fatalf("login: %d %v", response.Code, response.Header())
	}
	cookies := response.Result().Cookies()
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/auth/status", nil)
	request.AddCookie(cookies[0])
	status := httptest.NewRecorder()
	handler.ServeHTTP(status, request)
	if !strings.Contains(status.Body.String(), `"authenticated":true`) {
		t.Fatalf("status: %s", status.Body.String())
	}
}

func TestProjectImagesAndBrowserArtifactsPreserveBytesAndAuthority(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	policy, err := NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	projects := NewProjects(Store{Dir: t.TempDir()}, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	var original bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 8, 8))
	picture.Set(2, 3, color.RGBA{R: 120, G: 180, B: 60, A: 255})
	if err := png.Encode(&original, picture); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(root, "sample.png"), filepath.Join(outside, "private.png")} {
		if err := os.WriteFile(path, original.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(filepath.Join(outside, "private.png"), filepath.Join(root, "escape.png")); err != nil {
		t.Fatal(err)
	}
	large, err := os.Create(filepath.Join(root, "large.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err := large.Truncate(projectImageMaxBytes + 1); err != nil {
		t.Fatal(err)
	}
	large.Close()
	config := AuthConfig{Enabled: true, ControllerToken: "0123456789abcdef0123456789abcdef", BrowserEnabled: true, BrowserToken: "browser-token-0123456789abcdef0123456789"}
	handler, err := NewHTTPHandler(nil, ObjectiveHandler{}, projects, NewFiles(projects, policy), config, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	cookie, ok := handler.auth.Login(config.ControllerToken)
	if !ok {
		t.Fatal("fixture login failed")
	}
	read := func(path string, authorized bool) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+path, nil)
		if authorized {
			request.Header.Set("Cookie", strings.Split(SessionCookie(cookie, false), ";")[0])
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	path := "/files/" + project.ID + "/0/sample.png"
	if response := read(path, false); response.Code != http.StatusUnauthorized {
		t.Fatalf("image without authentication: %d", response.Code)
	}
	response := read(path, true)
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), original.Bytes()) || response.Header().Get("Content-Type") != "image/png" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("image bytes/headers: %d %v", response.Code, response.Header())
	}
	if _, err := png.Decode(bytes.NewReader(response.Body.Bytes())); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"/0/escape.png", "/0/large.png", "/1/sample.png", "/0/%2e%2e/private.png"} {
		if response := read("/files/"+project.ID+suffix, true); response.Code != http.StatusNotFound {
			t.Fatalf("unadmitted image %s: %d", suffix, response.Code)
		}
	}
	var mode atomic.Int32
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls.Add(1)
		if r.Header.Get("Authorization") != "Bearer "+config.BrowserToken || r.Header.Get("Cookie") != "" {
			t.Error("proxy credentials crossed their boundary")
		}
		if mode.Load() == 1 {
			w.Header().Set("Location", "http://other.invalid/private")
			w.WriteHeader(http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		size := original.Len()
		if mode.Load() == 2 {
			size = 64*1024*1024 + 1
		}
		w.Header().Set("Content-Length", strconv.Itoa(size))
		_, _ = w.Write(original.Bytes())
	}))
	defer upstream.Close()
	handler.Auth.BrowserURL = upstream.URL
	defer handler.browserClient.CloseIdleConnections()
	artifact := "/v1/artifacts/fixture/screenshot.png"
	if response := read(artifact, false); response.Code != http.StatusUnauthorized {
		t.Fatalf("artifact without authentication: %d", response.Code)
	}
	response = read(artifact, true)
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), original.Bytes()) {
		t.Fatal("artifact image bytes changed")
	}
	for _, kind := range []int32{1, 2} {
		mode.Store(kind)
		if response := read(artifact, true); response.Code != http.StatusBadGateway {
			t.Fatalf("invalid artifact accepted: %d", response.Code)
		}
	}
	if upstreamCalls.Load() != 3 {
		t.Fatal("proxy followed a redirect or fetched without authentication")
	}
	if response := read("/v1/artifacts/fixture/%2e%2e%2fscreenshot.png", true); response.Code != http.StatusNotFound || upstreamCalls.Load() != 3 {
		t.Fatal("artifact path escaped validation")
	}
}

func TestObjectiveHTTPBindsCredentialAndRejectsNullTasks(t *testing.T) {
	manager := NewSessionManager(nil, nil, nil, NewObjectives(Store{Dir: t.TempDir()}), nil)
	manager.sessions["session"] = newSessionEntry("session", "project", "/project", "", "bound-token")
	handler := ObjectiveHandler{Sessions: manager}
	call := func(token, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "http://gooseberry.test/mcp/objective", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	body := `{"id":1,"method":"tools/call","params":{"name":"objective_update","arguments":{"goal":"Ship"}}}`
	if response := call("wrong-token", body); response.Code != http.StatusUnauthorized {
		t.Fatalf("foreign credential: %d", response.Code)
	}
	if response := call("bound-token", body); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"projectId":"project"`) {
		t.Fatalf("objective: %s", response.Body.String())
	}
	response := call("bound-token", `{"id":2,"method":"tools/call","params":{"name":"objective_update","arguments":{"goal":"Changed","tasks":null}}}`)
	if !strings.Contains(response.Body.String(), `"error"`) {
		t.Fatalf("null task list accepted: %s", response.Body.String())
	}
	state, err := manager.objectives.Get("project", "session")
	if err != nil || state.Goal == nil || *state.Goal != "Ship" {
		t.Fatalf("invalid update changed state: %#v %v", state, err)
	}
}
