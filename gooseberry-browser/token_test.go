package main

import "testing"

func TestStrongToken(t *testing.T) {
	strong := "browser-token-0123456789abcdef0123456789"
	if !isStrongToken(strong) {
		t.Fatal("strong token was rejected")
	}
	for _, value := range []string{"short", "INVALID_REPLACE_WITH_RANDOM_BROWSER_TOKEN", string(make([]byte, tokenMaxLength+1))} {
		if isStrongToken(value) {
			t.Fatalf("invalid token accepted: %q", value)
		}
	}
	if err := assertStrongToken("short"); err == nil {
		t.Fatal("short token did not fail assertion")
	}
}
