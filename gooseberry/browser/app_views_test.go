package browser

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type appViewRegistrationResponse struct {
	Ticket    string `json:"ticket"`
	Path      string `json:"path"`
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
}

func registerAppViewForTest(t *testing.T, application *app, token string, body any) (*httptest.ResponseRecorder, appViewRegistrationResponse) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, appViewPath, bytes.NewReader(encoded))
	request.Host = "127.0.0.1:8787"
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	application.ServeHTTP(response, request)
	var result appViewRegistrationResponse
	if response.Code >= 200 && response.Code < 300 {
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
	}
	return response, result
}

func validAppViewRegistration() map[string]any {
	return map[string]any{
		"parentOrigin": "https://gooseberry.example",
		"csp": map[string]any{
			"connectDomains":  []string{"https://api.example.com", "wss://events.example.com"},
			"resourceDomains": []string{"https://cdn.example.com"},
			"frameDomains":    []string{"https://frames.example.com"},
			"baseUriDomains":  []string{"https://base.example.com"},
		},
		"permissions": map[string]any{"camera": map[string]any{}, "clipboardWrite": map[string]any{}},
	}
}

func TestAppViewTicketsKeepMutationAuthenticatedAndSandboxPublicByTicket(t *testing.T) {
	application, _, _ := testApp(t, true)
	unauthorized, _ := registerAppViewForTest(t, application, "", validAppViewRegistration())
	if unauthorized.Code != http.StatusUnauthorized || responseCode(t, unauthorized) != "unauthorized" {
		t.Fatalf("unauthorized registration = %d %s", unauthorized.Code, unauthorized.Body.String())
	}

	created, registration := registerAppViewForTest(t, application, testToken, validAppViewRegistration())
	if created.Code != http.StatusCreated || !appViewTicketPattern.MatchString(registration.Ticket) {
		t.Fatalf("registration = %d %#v", created.Code, registration)
	}
	if registration.Path != appViewPath+"/"+registration.Ticket || registration.URL != "http://127.0.0.1:8787"+registration.Path {
		t.Fatalf("registration URL = %#v", registration)
	}
	if _, err := time.Parse(time.RFC3339Nano, registration.ExpiresAt); err != nil {
		t.Fatalf("registration expiry = %q: %v", registration.ExpiresAt, err)
	}

	request := httptest.NewRequest(http.MethodGet, registration.Path, nil)
	request.Host = "127.0.0.1:8787"
	view := httptest.NewRecorder()
	application.ServeHTTP(view, request)
	if view.Code != http.StatusOK || view.Header().Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("public app view = %d %#v", view.Code, view.Header())
	}
	for name, expected := range map[string]string{
		"Cache-Control":          "no-store",
		"Referrer-Policy":        "no-referrer",
		"X-Content-Type-Options": "nosniff",
		"Permissions-Policy":     "camera=(self), microphone=(), geolocation=(), clipboard-write=(self)",
	} {
		if view.Header().Get(name) != expected {
			t.Fatalf("%s = %q", name, view.Header().Get(name))
		}
	}
	csp := view.Header().Get("Content-Security-Policy")
	for _, expected := range []string{
		"frame-ancestors 'self' https://gooseberry.example",
		"connect-src https://api.example.com wss://events.example.com",
		"script-src 'self' 'unsafe-inline' https://cdn.example.com",
		"frame-src https://frames.example.com",
		"base-uri https://base.example.com",
		"form-action 'self'",
		"sandbox allow-scripts allow-same-origin allow-forms",
	} {
		if !strings.Contains(csp, expected) {
			t.Fatalf("CSP missing %q: %s", expected, csp)
		}
	}
	if strings.Contains(csp, "unsafe-eval") || strings.Contains(csp, "blob:") {
		t.Fatalf("CSP widened the fixed sandbox: %s", csp)
	}
	document := view.Body.String()
	for _, expected := range []string{
		`event.origin !== expectedParentOrigin`,
		`event.source !== inner.contentWindow`,
		`ui/notifications/sandbox-proxy-ready`,
		`ui/notifications/sandbox-resource-ready`,
		`new TextEncoder().encode(html).byteLength > maxHTMLBytes`,
		`inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms")`,
		`inner.contentWindow.postMessage(event.data, ownOrigin)`,
		`isReservedSandboxMessage(event.data)`,
		`event.isTrusted && event.key === "Escape" && !event.defaultPrevented`,
		`method:"ui/notifications/request-teardown"`,
	} {
		if !strings.Contains(document, expected) {
			t.Fatalf("sandbox relay missing %q", expected)
		}
	}
	if !strings.Contains(document, `const allowedPermissions = new Set(["camera","clipboardWrite"]);`) {
		t.Fatal("sandbox relay did not bind the registered permission allowlist")
	}
	for _, forbidden := range []string{testToken, "Authorization", "Bearer ", "/mcp", "/v1/browser", "fetch(", "XMLHttpRequest", "WebSocket", "params.sandbox", "params.permissions", "params.csp"} {
		if strings.Contains(document, forbidden) {
			t.Fatalf("sandbox relay contains authority %q", forbidden)
		}
	}
	reboundRequest := httptest.NewRequest(http.MethodGet, registration.Path, nil)
	reboundRequest.Host = "evil.example:8787"
	rebound := httptest.NewRecorder()
	application.ServeHTTP(rebound, reboundRequest)
	if rebound.Code != http.StatusNotFound {
		t.Fatalf("ticket served through an unexpected Host: %d", rebound.Code)
	}

	deleteRequest := httptest.NewRequest(http.MethodDelete, registration.Path, nil)
	withoutAuth := httptest.NewRecorder()
	application.ServeHTTP(withoutAuth, deleteRequest)
	if withoutAuth.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized deletion = %d", withoutAuth.Code)
	}
	deleteRequest = httptest.NewRequest(http.MethodDelete, registration.Path, nil)
	deleteRequest.Header.Set("Authorization", "Bearer "+testToken)
	deleted := httptest.NewRecorder()
	application.ServeHTTP(deleted, deleteRequest)
	if deleted.Code != http.StatusOK {
		t.Fatalf("authenticated deletion = %d %s", deleted.Code, deleted.Body.String())
	}
	missing := httptest.NewRecorder()
	missingRequest := httptest.NewRequest(http.MethodGet, registration.Path, nil)
	missingRequest.Host = "127.0.0.1:8787"
	application.ServeHTTP(missing, missingRequest)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("deleted ticket remained readable: %d", missing.Code)
	}
}

func TestAppViewPolicyExpiryQuotaAndShutdownFailClosed(t *testing.T) {
	canonical, err := normalizeAppViewOrigin("https://gooseberry.example:443")
	if err != nil || canonical != "https://gooseberry.example" {
		t.Fatalf("canonical parent origin = %q, %v", canonical, err)
	}
	defaults := appViewCSPHeader(appViewPolicy{ParentOrigin: canonical})
	for _, expected := range []string{"script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'none'", "media-src 'self' data:", "connect-src 'none'", "frame-src 'none'", "form-action 'self'", "base-uri 'self'", "sandbox allow-scripts allow-same-origin allow-forms"} {
		if !strings.Contains(defaults, expected) {
			t.Fatalf("restrictive CSP defaults missing %q: %s", expected, defaults)
		}
	}
	if strings.Contains(defaults, "blob:") || strings.Contains(defaults, "worker-src") {
		t.Fatalf("restrictive CSP defaults admitted undeclared execution: %s", defaults)
	}

	withoutAuthentication, _, _ := testApp(t, false)
	response, _ := registerAppViewForTest(t, withoutAuthentication, "", validAppViewRegistration())
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("registration without configured bearer auth = %d", response.Code)
	}

	application, _, _ := testApp(t, true)
	application.config.PublicOrigin = "https://browser.example"
	clock := time.Unix(1_800_000_000, 0)
	application.appViews.now = func() time.Time { return clock }
	application.appViews.ttl = time.Minute
	application.appViews.maxEntries = 1

	for _, body := range []map[string]any{
		{"parentOrigin": "https://gooseberry.example; frame-src *"},
		{"parentOrigin": "https://gooseberry.example", "csp": map[string]any{"resourceDomains": []string{"https://cdn.example.com; script-src *"}}},
		{"parentOrigin": "https://gooseberry.example", "permissions": map[string]any{"downloads": map[string]any{}}},
		{"parentOrigin": "https://gooseberry.example", "unknown": true},
		{"parentOrigin": "https://browser.example:443"},
		{"parentOrigin": "https://*.example.com"},
	} {
		response, _ := registerAppViewForTest(t, application, testToken, body)
		if response.Code != http.StatusBadRequest || responseCode(t, response) != "invalid_app_view" {
			t.Fatalf("unsafe policy accepted: %d %s", response.Code, response.Body.String())
		}
	}

	first, registration := registerAppViewForTest(t, application, testToken, validAppViewRegistration())
	if first.Code != http.StatusCreated || registration.URL != "https://browser.example"+registration.Path {
		t.Fatalf("public-origin registration = %d %#v", first.Code, registration)
	}
	second, _ := registerAppViewForTest(t, application, testToken, validAppViewRegistration())
	if second.Code != http.StatusTooManyRequests || responseCode(t, second) != "app_view_limit" {
		t.Fatalf("ticket quota = %d %s", second.Code, second.Body.String())
	}

	clock = clock.Add(time.Minute)
	if _, found := application.appViews.get(registration.Ticket); found {
		t.Fatal("expired app view ticket remained readable")
	}
	third, next := registerAppViewForTest(t, application, testToken, validAppViewRegistration())
	if third.Code != http.StatusCreated {
		t.Fatalf("expired ticket did not release quota: %d %s", third.Code, third.Body.String())
	}
	application.shutdown()
	if _, found := application.appViews.get(next.Ticket); found {
		t.Fatal("shutdown retained app view tickets")
	}
	if _, _, err := application.appViews.register(appViewPolicy{ParentOrigin: canonical}); err == nil {
		t.Fatal("shutdown allowed a late app view registration")
	}
}
