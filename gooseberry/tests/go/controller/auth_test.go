package controller_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/miloszkolber/gooseberry/internal/controller"
)

func TestAuthenticationBindsCookiesToTheConfiguredOrigin(t *testing.T) {
	token := "controller-token-0123456789abcdef0123456789"
	auth, err := controller.NewAuth(token)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := auth.Login("wrong"); ok {
		t.Fatal("invalid controller token was accepted")
	}
	session, ok := auth.Login(token)
	if !ok {
		t.Fatal("valid controller token was rejected")
	}
	expires, ok := auth.SessionExpiresAt(session)
	if !ok || time.Until(expires) < controller.SessionMaxAge-time.Minute || time.Until(expires) > controller.SessionMaxAge+time.Minute {
		t.Fatalf("unexpected session expiry: %v, %v", expires, ok)
	}

	config := controller.AuthConfig{Enabled: true, ControllerToken: token, PublicOrigin: "https://gooseberry.example"}
	handler, err := controller.NewHTTPHandler(nil, controller.ObjectiveHandler{}, nil, nil, config, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	login := func(origin, fetchSite string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "http://internal/auth/login", strings.NewReader(`{"token":"`+token+`"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", origin)
		request.Header.Set("Sec-Fetch-Site", fetchSite)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	if response := login("https://untrusted.example", "same-origin"); response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin login returned %d", response.Code)
	}
	if response := login(config.PublicOrigin, "cross-site"); response.Code != http.StatusForbidden {
		t.Fatalf("cross-site login returned %d", response.Code)
	}
	response := login(config.PublicOrigin, "same-origin")
	if response.Code != http.StatusOK {
		t.Fatalf("same-origin login returned %d: %s", response.Code, response.Body.String())
	}
	cookie := response.Header().Get("Set-Cookie")
	for _, attribute := range []string{"HttpOnly", "SameSite=Strict", "Secure", "Path=/"} {
		if !strings.Contains(cookie, attribute) {
			t.Fatalf("session cookie omitted %s: %q", attribute, cookie)
		}
	}
}

func TestRemoteAndBrowserConfigurationFailsClosed(t *testing.T) {
	token := "browser-token-0123456789abcdef0123456789"
	for _, test := range []struct {
		name   string
		values map[string]string
		valid  bool
	}{
		{name: "loopback defaults", values: map[string]string{}, valid: true},
		{name: "unauthenticated remote controller", values: map[string]string{"GOOSEBERRY_CONTROLLER_HOST": "0.0.0.0"}},
		{name: "authenticated remote controller", values: map[string]string{
			"GOOSEBERRY_CONTROLLER_HOST": "0.0.0.0", "GOOSEBERRY_AUTH_ENABLED": "true", "GOOSEBERRY_TOKEN": "controller-token-0123456789abcdef0123456789",
		}, valid: true},
		{name: "unauthenticated remote browser", values: map[string]string{"GOOSEBERRY_BROWSER_URL": "http://browser:8787"}},
		{name: "browser URL with credentials", values: map[string]string{
			"GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_TOKEN": token, "GOOSEBERRY_BROWSER_URL": "http://user:secret@browser:8787",
		}},
		{name: "same application and sandbox origin", values: map[string]string{
			"GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_TOKEN": token,
			"GOOSEBERRY_PUBLIC_ORIGIN": "https://same.example", "GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://same.example",
		}},
		{name: "isolated authenticated sandbox", values: map[string]string{
			"GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_TOKEN": token,
			"GOOSEBERRY_PUBLIC_ORIGIN": "https://gooseberry.example:443", "GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://sandbox.example:443",
		}, valid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			config, err := controller.ReadAuthConfig(func(key string) string { return test.values[key] })
			if (err == nil) != test.valid {
				t.Fatalf("configuration %#v: %v", config, err)
			}
			if test.valid && strings.HasSuffix(config.BrowserURL, "/") {
				t.Fatalf("browser origin was not normalized: %q", config.BrowserURL)
			}
		})
	}
}

func TestMCPHostCredentialOwnsSharedBrowserOrigin(t *testing.T) {
	browserToken := "browser-token-0123456789abcdef0123456789"
	mcpToken := "mcp-token-0123456789abcdef0123456789"
	config, err := controller.ReadAuthConfig(func(key string) string {
		return map[string]string{
			"GOOSEBERRY_BROWSER_AUTH":  "true",
			"GOOSEBERRY_BROWSER_TOKEN": browserToken,
			"GOOSEBERRY_MCP_URL":       "http://127.0.0.1:8787",
			"GOOSEBERRY_MCP_TOKEN":     mcpToken,
		}[key]
	})
	if err != nil {
		t.Fatal(err)
	}
	authenticated, token := config.BrowserServiceAuth()
	if !authenticated || token != mcpToken {
		t.Fatalf("shared MCP browser credential = %v, %q", authenticated, token)
	}

	config.MCPURL = "http://127.0.0.1:8788"
	authenticated, token = config.BrowserServiceAuth()
	if !authenticated || token != browserToken {
		t.Fatalf("standalone browser credential = %v, %q", authenticated, token)
	}

	remote, err := controller.ReadAuthConfig(func(key string) string {
		return map[string]string{
			"GOOSEBERRY_MCP_URL":   "https://mcp.example:443",
			"GOOSEBERRY_MCP_TOKEN": mcpToken,
		}[key]
	})
	if err != nil {
		t.Fatal(err)
	}
	if remote.BrowserURL != "https://mcp.example" {
		t.Fatalf("MCP origin was not reused for Browser HTTP: %q", remote.BrowserURL)
	}
	authenticated, token = remote.BrowserServiceAuth()
	if !authenticated || token != mcpToken {
		t.Fatalf("remote MCP browser credential = %v, %q", authenticated, token)
	}
}
