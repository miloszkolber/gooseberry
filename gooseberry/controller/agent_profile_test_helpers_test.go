package controller

func testGooseInitializeResponse() map[string]any {
	return map[string]any{
		"protocolVersion": 1,
		"agentInfo":       map[string]any{"name": "goose", "version": "1.48.0"},
		"agentCapabilities": map[string]any{
			"_meta":       map[string]any{"goose": map[string]any{}},
			"loadSession": true,
			"sessionCapabilities": map[string]any{
				"list":   map[string]any{},
				"delete": map[string]any{},
				"close":  map[string]any{},
			},
			"promptCapabilities": map[string]any{"image": true, "embeddedContext": true},
			"mcpCapabilities":    map[string]any{"http": true},
		},
		"authMethods": []any{},
	}
}
