package controller

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestAuthCookieAndOriginRemainCompatible(t *testing.T) {
	auth, err := NewAuth("0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	auth.now = func() time.Time { return time.Unix(1_800_000_000, 0) }
	cookie, ok := auth.Login("0123456789abcdef0123456789abcdef")
	if !ok {
		t.Fatal("valid credential was rejected")
	}
	expires, ok := auth.SessionExpiresAt(cookie)
	if !ok || expires.Unix() != 1_800_000_000+int64(SessionMaxAge/time.Second) {
		t.Fatalf("unexpected expiry: %v, %v", expires, ok)
	}

	request := httptest.NewRequest("GET", "http://127.0.0.1:7312/ws", nil)
	request.Header.Set("Origin", "http://127.0.0.1:7312")
	config := AuthConfig{}
	if !config.IsExpectedOrigin(request) {
		t.Fatal("same origin request was rejected")
	}
	request.Header.Set("Origin", "http://localhost:7312")
	if config.IsExpectedOrigin(request) {
		t.Fatal("cross origin request was accepted")
	}
}

func TestBrowserProxyConfigurationKeepsCredentialsAtTrustedOrigin(t *testing.T) {
	for _, test := range []struct {
		endpoint    string
		auth, valid bool
	}{
		{"", false, true},
		{"http://[::1]:8787", false, true},
		{"http://browser:8787", false, false},
		{"http://browser:8787/", true, true},
		{"https://browser.example", true, true},
		{"http://user:secret@browser:8787", true, false},
		{"http://browser:8787/mcp", true, false},
		{"http://browser:8787?token=secret", true, false},
		{"file:///tmp/browser", true, false},
	} {
		t.Run(test.endpoint, func(t *testing.T) {
			values := map[string]string{"GOOSEBERRY_BROWSER_URL": test.endpoint}
			if test.auth {
				values["GOOSEBERRY_BROWSER_AUTH"] = "true"
				values["GOOSEBERRY_BROWSER_TOKEN"] = "browser-token-0123456789abcdef0123456789"
			}
			config, err := ReadAuthConfig(func(key string) string { return values[key] })
			if (err == nil) != test.valid {
				t.Fatalf("configuration: %#v, %v", config, err)
			}
			if test.valid && (config.BrowserURL == "" || config.BrowserURL[len(config.BrowserURL)-1] == '/') {
				t.Fatalf("browser URL is not normalized: %q", config.BrowserURL)
			}
		})
	}
}

func TestBrowserPublicOriginRequiresIsolationAndAuthentication(t *testing.T) {
	token := "browser-token-0123456789abcdef0123456789"
	for name, test := range map[string]struct {
		values map[string]string
		valid  bool
	}{
		"distinct authenticated origins": {values: map[string]string{
			"GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_TOKEN": token,
			"GOOSEBERRY_PUBLIC_ORIGIN": "https://gooseberry.example:443", "GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://sandbox.example:443",
		}, valid: true},
		"same public origin": {values: map[string]string{
			"GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_TOKEN": token,
			"GOOSEBERRY_PUBLIC_ORIGIN": "https://same.example", "GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://same.example",
		}},
		"unauthenticated sandbox": {values: map[string]string{"GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://sandbox.example"}},
		"sandbox path": {values: map[string]string{
			"GOOSEBERRY_BROWSER_AUTH": "true", "GOOSEBERRY_BROWSER_TOKEN": token, "GOOSEBERRY_BROWSER_PUBLIC_ORIGIN": "https://sandbox.example/app",
		}},
	} {
		t.Run(name, func(t *testing.T) {
			config, err := ReadAuthConfig(func(key string) string { return test.values[key] })
			if (err == nil) != test.valid {
				t.Fatalf("configuration %#v, error %v", config, err)
			}
			if test.valid && config.BrowserPublicOrigin != "https://sandbox.example" {
				t.Fatalf("browser public origin was not retained: %q", config.BrowserPublicOrigin)
			}
		})
	}
}
