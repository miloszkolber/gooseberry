package browser

import "testing"

func validBody(command string, args ...string) map[string]any {
	values := make([]any, len(args))
	for index, value := range args {
		values[index] = value
	}
	return map[string]any{"session": "smoke", "command": command, "args": values}
}

func TestBrowserPolicyAcceptsBoundedOperations(t *testing.T) {
	for _, body := range []map[string]any{
		validBody("open", "https://example.com"),
		validBody("snapshot", "--compact", "--depth", "3"),
		validBody("wait", "30000"),
		validBody("scroll", "down", "300"),
		validBody("set", "viewport", "1280", "720"),
		validBody("get", "text", "@e1"),
		validBody("is", "visible", "@e1"),
		validBody("screenshot", "screen.png"),
	} {
		if _, err := validateBrowserRequest(body); err != nil {
			t.Fatalf("valid request rejected: %v", err)
		}
	}
}

func TestBrowserPolicyRejectsEscapeHatches(t *testing.T) {
	for _, body := range []map[string]any{
		validBody("open", "https://user:pass@example.com"),
		validBody("open", "file:///etc/passwd"),
		validBody("open", "javascript:alert(1)"),
		validBody("open", "--profile", "x", "https://example.com"),
		validBody("snapshot", "--headers", "x"),
		validBody("screenshot", "../screen.png"),
		validBody("wait", "30001"),
		validBody("set", "viewport", "9999", "720"),
		{"session": "../x", "command": "close", "args": []any{}},
		{"session": "x", "command": "eval", "args": []any{}},
		{"session": "x", "command": "close", "args": []any{}, "raw": true},
	} {
		if _, err := validateBrowserRequest(body); err == nil {
			t.Fatalf("invalid request accepted: %#v", body)
		}
	}
}
