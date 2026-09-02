package controller

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
)

func TestGooseAdministrationScopesSecretsAndScansRecipes(t *testing.T) {
	var recipeSaves atomic.Int32
	var recipeDeletes atomic.Int32
	var recipeWarnings atomic.Bool
	var malformedRecipeSave atomic.Bool
	var commandCatalogChanges atomic.Int32
	var authentications atomic.Int32
	var failProviderSave atomic.Bool
	savedCredential := make(chan string, 1)
	recipeWarnings.Store(true)
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
			var result any = map[string]any{}
			var failure any
			switch rpc.Method {
			case "initialize":
				result = testGooseInitializeResponse()
			case "_goose/unstable/providers/list":
				result = map[string]any{"entries": []any{map[string]any{"providerId": "manual", "configKeys": []any{map[string]any{"name": "TOKEN", "secret": true, "required": true}}}, map[string]any{"providerId": "native", "configKeys": []any{map[string]any{"name": "OAUTH", "oauthFlow": true}}}}}
			case "_goose/unstable/providers/config/authenticate":
				authentications.Add(1)
			case "_goose/unstable/providers/config/read":
				result = map[string]any{"fields": []any{}}
			case "_goose/unstable/providers/config/save":
				if failProviderSave.Load() {
					failure = map[string]any{"code": -32603, "message": "rejected error-secret credential"}
					break
				}
				fields := arrayValue(rpc.Params["fields"])
				if len(fields) == 1 {
					savedCredential <- textValue(mapValue(fields[0])["value"])
				}
			case "_goose/unstable/config/extensions/list":
				result = map[string]any{"extensions": []any{map[string]any{"enabled": true, "configKey": "private", "extension": map[string]any{"type": "mcp", "server": map[string]any{"name": "private", "env": map[string]any{"TOKEN": "extension-secret"}}}}}, "warnings": []any{}}
			case "_goose/unstable/extensions/available":
				result = map[string]any{"extensions": []any{}}
			case "_goose/unstable/recipes/scan":
				result = map[string]any{"has_security_warnings": recipeWarnings.Load()}
			case "_goose/unstable/recipes/save":
				recipeSaves.Add(1)
				if malformedRecipeSave.Load() {
					result = map[string]any{"id": "saved"}
				} else {
					result = map[string]any{"id": "saved", "file_name": "saved.yaml", "file_path": "/private/recipe/saved.yaml"}
				}
			case "_goose/unstable/recipes/delete":
				recipeDeletes.Add(1)
			case "_goose/unstable/providers/config/delete":
				failure = map[string]any{"code": -32603, "message": "private-config-path and error-secret"}
			}
			if len(rpc.ID) > 0 {
				reply := map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}
				if failure != nil {
					delete(reply, "result")
					reply["error"] = failure
				}
				if writeTestRPC(connection, reply) != nil {
					return
				}
			}
		}
	}))
	defer server.Close()
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "fixture", "test", nil)
	defer client.Close()
	admin := NewGooseAdmin(client, NewSettings(Store{Dir: t.TempDir()}, nil))
	admin.publish = func(channel string, _ any) {
		if channel == "goose.commandCatalogChanged" {
			commandCatalogChanges.Add(1)
		}
	}
	defer admin.logins.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := admin.logins.Start(ctx, "browser-a", "manual", "api_key")
	if err != nil {
		t.Fatal(err)
	}
	loginID := textValue(mapValue(result)["loginId"])
	if loginID == "" || mapValue(mapValue(result)["frame"])["secret"] != true {
		t.Fatalf("login result: %#v", result)
	}
	if _, err := admin.logins.Start(ctx, "browser-b", "manual", "api_key"); err == nil {
		t.Fatal("allowed simultaneous provider mutation")
	}
	if err := admin.logins.Reply("browser-b", loginID, "wrong"); err == nil {
		t.Fatal("accepted another browser's reply")
	}
	if err := admin.logins.Reply("browser-a", loginID, "  credential  "); err != nil {
		t.Fatal(err)
	}
	select {
	case value := <-savedCredential:
		if value != "  credential  " {
			t.Fatalf("secret changed: %q", value)
		}
	case <-ctx.Done():
		t.Fatal("credential was not saved")
	}
	snapshot, _ := json.Marshal(admin.logins.Snapshot("browser-a"))
	if strings.Contains(string(snapshot), "credential") || !strings.Contains(string(snapshot), "success") || admin.logins.Snapshot("browser-b") != nil {
		t.Fatalf("unsafe login snapshot: %s", snapshot)
	}
	catalog, err := admin.extensionCatalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(catalog)
	if strings.Contains(string(encoded), "extension-secret") || strings.Contains(string(encoded), `"server"`) {
		t.Fatalf("raw extension leaked: %s", encoded)
	}
	_, err = admin.handleAutomation(ctx, "goose.recipeSave", map[string]any{"recipe": map[string]any{"title": "Unsafe", "description": "Fixture"}})
	if err == nil || recipeSaves.Load() != 0 || commandCatalogChanges.Load() != 0 {
		t.Fatal("saved a recipe with security warnings")
	}
	recipeWarnings.Store(false)
	result, err = admin.handleAutomation(ctx, "goose.recipeSave", map[string]any{"recipe": map[string]any{"title": "Safe", "description": "Fixture"}})
	if err != nil || recipeSaves.Load() != 1 || commandCatalogChanges.Load() != 1 || textValue(mapValue(result)["id"]) != "saved" {
		t.Fatalf("successful recipe save did not publish command invalidation: %#v, %v", result, err)
	}
	malformedRecipeSave.Store(true)
	if _, err = admin.handleAutomation(ctx, "goose.recipeSave", map[string]any{"recipe": map[string]any{"title": "Changed", "description": "Fixture"}}); err == nil || recipeSaves.Load() != 2 || commandCatalogChanges.Load() != 2 {
		t.Fatal("mutated recipe with a malformed response did not publish command invalidation")
	}
	if _, err = admin.handleAutomation(ctx, "goose.recipeDelete", map[string]any{"id": ""}); err == nil || commandCatalogChanges.Load() != 2 {
		t.Fatal("invalid recipe delete published command invalidation")
	}
	result, err = admin.handleAutomation(ctx, "goose.recipeDelete", map[string]any{"id": "saved"})
	if err != nil || recipeDeletes.Load() != 1 || commandCatalogChanges.Load() != 3 || mapValue(result)["ok"] != true {
		t.Fatalf("successful recipe delete did not publish command invalidation: %#v, %v", result, err)
	}
	result, err = admin.logins.Start(ctx, "browser-a", "native", "oauth")
	if err != nil {
		t.Fatal(err)
	}
	deferred, ok := result.(deferredResponse)
	if !ok {
		t.Fatal("native login did not defer authentication until its response")
	}
	loginID = textValue(mapValue(deferred.result)["loginId"])
	admin.logins.mu.Lock()
	login := admin.logins.pending[loginID]
	admin.logins.mu.Unlock()
	if err := admin.logins.Cancel("browser-a", loginID); err != nil {
		t.Fatal(err)
	}
	admin.logins.authenticate(login)
	if authentications.Load() != 0 || admin.logins.Snapshot("browser-a") != nil {
		t.Fatal("cancelled deferred login still authenticated or published")
	}
	failProviderSave.Store(true)
	result, err = admin.logins.Start(ctx, "browser-a", "manual", "api_key")
	if err != nil {
		t.Fatal(err)
	}
	if err := admin.logins.Reply("browser-a", textValue(mapValue(result)["loginId"]), "error-secret"); err != nil {
		t.Fatal(err)
	}
	snapshot, _ = json.Marshal(admin.logins.Snapshot("browser-a"))
	if strings.Contains(string(snapshot), "error-secret") || !strings.Contains(string(snapshot), `"kind":"error"`) {
		t.Fatalf("unsafe error snapshot: %s", snapshot)
	}
	if err := admin.LogoutProvider(ctx, "manual"); err == nil || strings.Contains(err.Error(), "private-config-path") || strings.Contains(err.Error(), "error-secret") {
		t.Fatalf("unsafe administration error: %v", err)
	}
}
