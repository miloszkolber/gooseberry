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
