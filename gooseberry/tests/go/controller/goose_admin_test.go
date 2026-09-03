package controller_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/miloszkolber/gooseberry/internal/controller"
	"github.com/miloszkolber/gooseberry/internal/persist"
)

func TestGooseAdminModelsRequireExplicitProviderConfiguration(t *testing.T) {
	configured := true
	providers := []map[string]any{
		{"providerId": "missing", "models": []any{map[string]any{"id": "model"}}},
		{"providerId": "false", "configured": false, "models": []any{map[string]any{"id": "model"}}},
		{"providerId": "unavailable", "configured": configured, "available": false, "models": []any{map[string]any{"id": "model"}}},
		{"providerId": "refresh-error", "configured": configured, "available": true, "lastRefreshError": "authentication failed", "models": []any{map[string]any{"id": "model"}}},
		{"providerId": "available", "configured": configured, "available": true, "models": []any{map[string]any{"id": "model"}}},
	}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.CloseNow()
		for {
			_, payload, err := connection.Read(context.Background())
			if err != nil {
				return
			}
			var rpc struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			if err := json.Unmarshal(payload, &rpc); err != nil {
				return
			}
			var result any = map[string]any{}
			if rpc.Method == "initialize" {
				result = gooseInitializeResponse()
			} else if rpc.Method == "_goose/unstable/providers/list" {
				result = map[string]any{"entries": providers}
			}
			if err := writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", nil)
	defer client.Close()
	admin := controller.NewGooseAdmin(client, controller.NewSettings(persist.Store{Dir: t.TempDir()}, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	models, err := admin.Models(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"missing": false, "false": false, "unavailable": false, "refresh-error": true, "available": true}
	for _, model := range models {
		if model.ID != "model" {
			t.Fatalf("unexpected model: %#v", model)
		}
		if model.Available != want[model.Provider] {
			t.Errorf("%s availability = %v, want %v", model.Provider, model.Available, want[model.Provider])
		}
		delete(want, model.Provider)
	}
	if len(want) != 0 {
		t.Fatalf("missing providers: %#v", want)
	}
}

func TestGooseAdminRefreshModelsWaitsForInventoryCompletion(t *testing.T) {
	var providerReads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.CloseNow()
		for {
			_, payload, err := connection.Read(context.Background())
			if err != nil {
				return
			}
			var rpc struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			var result any = map[string]any{}
			switch rpc.Method {
			case "initialize":
				result = gooseInitializeResponse()
			case "_goose/unstable/providers/inventory/refresh":
				result = map[string]any{"started": []string{"dynamic"}}
			case "_goose/unstable/providers/list":
				read := providerReads.Add(1)
				result = map[string]any{"entries": []any{map[string]any{"providerId": "dynamic", "configured": true, "available": true, "refreshing": read == 1}}}
			}
			if err := writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", nil)
	defer client.Close()
	admin := controller.NewGooseAdmin(client, controller.NewSettings(persist.Store{Dir: t.TempDir()}, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := admin.RefreshModels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result["complete"] != true || providerReads.Load() < 3 {
		t.Fatalf("refresh returned before the completed inventory was reloaded: %#v, reads=%d", result, providerReads.Load())
	}
}

func TestGooseAdminRefreshModelsRejectsMissingRefreshingProvider(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.CloseNow()
		for {
			_, payload, err := connection.Read(context.Background())
			if err != nil {
				return
			}
			var rpc struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			var result any = map[string]any{}
			if rpc.Method == "initialize" {
				result = gooseInitializeResponse()
			} else if rpc.Method == "_goose/unstable/providers/inventory/refresh" {
				result = map[string]any{"started": []string{"removed"}}
			} else if rpc.Method == "_goose/unstable/providers/list" {
				result = map[string]any{"entries": []any{}}
			}
			if writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()

	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", nil)
	defer client.Close()
	admin := controller.NewGooseAdmin(client, controller.NewSettings(persist.Store{Dir: t.TempDir()}, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := admin.RefreshModels(ctx); err == nil || !strings.Contains(err.Error(), "lost provider removed") {
		t.Fatalf("missing refresh provider was not rejected: %v", err)
	}
}

func TestGooseAdminRefreshModelsReportsIncompleteCanonicalMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.CloseNow()
		for {
			_, payload, err := connection.Read(context.Background())
			if err != nil {
				return
			}
			var rpc struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			if rpc.Method == "_goose/unstable/providers/canonical-model-info" {
				continue
			}
			var result any = map[string]any{}
			if rpc.Method == "initialize" {
				result = gooseInitializeResponse()
			} else if rpc.Method == "_goose/unstable/providers/inventory/refresh" {
				result = map[string]any{"started": []string{}}
			} else if rpc.Method == "_goose/unstable/providers/list" {
				result = map[string]any{"entries": []any{map[string]any{"providerId": "available", "configured": true, "available": true, "models": []any{map[string]any{"id": "slow-model"}}}}}
			}
			if writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()

	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", nil)
	defer client.Close()
	admin := controller.NewGooseAdmin(client, controller.NewSettings(persist.Store{Dir: t.TempDir()}, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	result, err := admin.RefreshModels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result["complete"] != false || len(result["models"].([]controller.WireModel)) != 1 {
		t.Fatalf("canonical timeout was reported as complete: %#v", result)
	}
}
