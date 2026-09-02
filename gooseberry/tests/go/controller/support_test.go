package controller_test

import (
	"context"
	"encoding/json"
	"sync"

	acp "github.com/coder/acp-go-sdk"
	"github.com/coder/websocket"
)

type recordingEvents struct {
	mu      sync.Mutex
	methods []string
}

func (e *recordingEvents) SessionUpdate(context.Context, acp.SessionNotification) error {
	return nil
}

func (e *recordingEvents) Extension(_ context.Context, method string, _ json.RawMessage) error {
	e.mu.Lock()
	e.methods = append(e.methods, method)
	e.mu.Unlock()
	return nil
}

func (e *recordingEvents) Permission(context.Context, acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	return acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}, nil
}

func (e *recordingEvents) snapshot() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.methods...)
}

func gooseInitializeResponse() map[string]any {
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

func writeRPC(connection *websocket.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return connection.Write(context.Background(), websocket.MessageText, payload)
}
