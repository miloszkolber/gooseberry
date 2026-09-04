package controller_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/miloszkolber/gooseberry/internal/controller"
	"github.com/miloszkolber/gooseberry/internal/persist"
)

const gatewayTestToken = "gateway-test-token-0123456789abcdef0123456789"

func TestMCPGatewayCatalogIsOptionalAndValidatesModulePaths(t *testing.T) {
	optional := controller.NewMCPGateway(controller.AuthConfig{})
	catalog, err := optional.Catalog(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if catalog["schemaVersion"] != 1 || catalog["gateway"].(map[string]any)["state"] != "not-configured" {
		t.Fatalf("optional catalog = %#v", catalog)
	}

	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		authorization = request.Header.Get("Authorization")
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"schemaVersion":1,"revision":"rev-1","gateway":{"state":"ready"},"modules":[{"id":"browser","extensionName":"gooseberry-browser","displayName":"Gooseberry Browser","description":"Browser","path":"/browser","transport":"streamable_http","state":"ready"}]}`))
	}))
	defer server.Close()
	gateway := controller.NewMCPGateway(controller.AuthConfig{MCPURL: server.URL, MCPToken: gatewayTestToken})
	catalog, err = gateway.Catalog(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if authorization != "Bearer "+gatewayTestToken {
		t.Fatalf("catalog authorization = %q", authorization)
	}
	modules := catalog["modules"].([]map[string]any)
	if len(modules) != 1 || modules[0]["id"] != "browser" || modules[0]["binding"] != "unavailable" {
		t.Fatalf("catalog modules = %#v", modules)
	}

	bad := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(`{"schemaVersion":1,"revision":"rev-1","gateway":{"state":"ready"},"modules":[{"id":"browser","extensionName":"gooseberry-browser","displayName":"Browser","description":"","path":"http://evil.example","transport":"streamable_http","state":"ready"}]}`))
	}))
	defer bad.Close()
	badGateway := controller.NewMCPGateway(controller.AuthConfig{MCPURL: bad.URL})
	badCatalog, err := badGateway.Catalog(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if badCatalog["gateway"].(map[string]any)["state"] != "incompatible" {
		t.Fatalf("invalid catalog was accepted: %#v", badCatalog)
	}
}

func TestMCPGatewayInstallsAndTogglesOnlyTheDiscoveredEndpoint(t *testing.T) {
	moduleServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(`{"schemaVersion":1,"revision":"rev-1","gateway":{"state":"ready"},"modules":[{"id":"browser","extensionName":"gooseberry-browser","displayName":"Gooseberry Browser","description":"Browser","path":"/browser","transport":"streamable_http","state":"ready"}]}`))
	}))
	defer moduleServer.Close()
	acpServer, state := gatewayACP(t)
	defer acpServer.Close()
	client := controller.NewGooseClient("ws"+strings.TrimPrefix(acpServer.URL, "http"), "", "test", nil)
	defer client.Close()
	admin := controller.NewGooseAdmin(client, controller.NewSettings(persist.Store{Dir: t.TempDir()}, nil))
	gateway := controller.NewMCPGateway(controller.AuthConfig{MCPURL: moduleServer.URL, MCPToken: gatewayTestToken})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := gateway.SetGooseEnabled(ctx, admin, "browser", true, "rev-1")
	if err != nil {
		t.Fatal(err)
	}
	modules := result["modules"].([]map[string]any)
	if len(modules) != 1 || modules[0]["binding"] != "enabled" {
		t.Fatalf("installed module binding = %#v", modules)
	}
	state.mu.Lock()
	if len(state.extensions) != 1 {
		state.mu.Unlock()
		t.Fatalf("installed extensions = %#v", state.extensions)
	}
	extension := state.extensions[0].(map[string]any)
	serverConfig := extension["server"].(map[string]any)
	if serverConfig["url"] != moduleServer.URL+"/browser" || serverConfig["name"] != "gooseberry-browser" || serverConfig["type"] != "http" {
		state.mu.Unlock()
		t.Fatalf("installed MCP server = %#v", serverConfig)
	}
	if serverConfig["headers"].([]any)[0].(map[string]any)["value"] != "Bearer ${GOOSEBERRY_MCP_TOKEN}" {
		state.mu.Unlock()
		t.Fatalf("installed MCP header = %#v", serverConfig["headers"])
	}
	state.mu.Unlock()

	result, err = gateway.SetGooseEnabled(ctx, admin, "browser", false, "rev-1")
	if err != nil {
		t.Fatal(err)
	}
	modules = result["modules"].([]map[string]any)
	if modules[0]["binding"] != "disabled" {
		t.Fatalf("disabled module binding = %#v", modules[0])
	}
}

func TestMCPGatewayRejectsAnExistingExtensionWithTheWrongCredential(t *testing.T) {
	moduleServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(`{"schemaVersion":1,"revision":"rev-1","gateway":{"state":"ready"},"modules":[{"id":"browser","extensionName":"gooseberry-browser","displayName":"Browser","description":"Browser","path":"/browser","transport":"streamable_http","state":"ready"}]}`))
	}))
	defer moduleServer.Close()
	acpServer, state := gatewayACP(t)
	defer acpServer.Close()
	state.mu.Lock()
	state.extensions = []any{map[string]any{
		"type": "mcp",
		"server": map[string]any{
			"type": "http", "name": "gooseberry-browser", "url": moduleServer.URL + "/browser",
			"headers": []any{map[string]any{"name": "Authorization", "value": "Bearer ${GOOSEBERRY_BROWSER_TOKEN}"}},
		},
	}}
	state.enabled = true
	state.mu.Unlock()
	client := controller.NewGooseClient("ws"+strings.TrimPrefix(acpServer.URL, "http"), "", "test", nil)
	defer client.Close()
	admin := controller.NewGooseAdmin(client, controller.NewSettings(persist.Store{Dir: t.TempDir()}, nil))
	gateway := controller.NewMCPGateway(controller.AuthConfig{MCPURL: moduleServer.URL, MCPToken: gatewayTestToken})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := gateway.SetGooseEnabled(ctx, admin, "browser", true, "rev-1"); err == nil || !strings.Contains(err.Error(), "different credential") {
		t.Fatalf("wrong credential was accepted: %v", err)
	}
}

type gatewayACPState struct {
	mu         sync.Mutex
	extensions []any
	enabled    bool
}

func gatewayACP(t *testing.T) (*httptest.Server, *gatewayACPState) {
	t.Helper()
	state := &gatewayACPState{}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(response, request, nil)
		if err != nil {
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
				Params map[string]any  `json:"params"`
			}
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			result := any(map[string]any{})
			switch rpc.Method {
			case "initialize":
				result = gooseInitializeResponse()
			case "_goose/unstable/config/extensions/list":
				state.mu.Lock()
				entries := make([]any, 0, len(state.extensions))
				for _, extension := range state.extensions {
					entries = append(entries, map[string]any{"extension": extension, "enabled": state.enabled, "configKey": "gateway-browser"})
				}
				state.mu.Unlock()
				result = map[string]any{"extensions": entries, "warnings": []any{}}
			case "_goose/unstable/config/extensions/add":
				state.mu.Lock()
				state.extensions = append(state.extensions, rpc.Params["extension"])
				state.enabled = true
				state.mu.Unlock()
			case "_goose/unstable/config/extensions/set-enabled":
				state.mu.Lock()
				state.enabled, _ = rpc.Params["enabled"].(bool)
				state.mu.Unlock()
			}
			if len(rpc.ID) > 0 {
				_ = writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result})
			}
		}
	}))
	return server, state
}
