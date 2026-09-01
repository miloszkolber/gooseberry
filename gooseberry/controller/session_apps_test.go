package controller

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestCanceledAppOperationStopsWaitingForSession(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	root := t.TempDir()
	policy, err := NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := Store{Dir: t.TempDir()}
	projects := NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "chat", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}

	upstreamStarted := make(chan struct{}, 1)
	releaseUpstream := make(chan struct{}, 1)
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
			}
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			var result any
			switch rpc.Method {
			case "initialize":
				result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}, "authMethods": []any{}}
			case "_goose/unstable/resources/read":
				upstreamStarted <- struct{}{}
				select {
				case <-releaseUpstream:
				case <-ctx.Done():
					return
				}
				result = map[string]any{"result": map[string]any{"contents": []any{map[string]any{
					"uri": "ui://apps/fixture", "mimeType": "text/plain", "text": "fixture",
				}}}}
			default:
				result = map[string]any{}
			}
			if len(rpc.ID) > 0 && writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()

	manager := NewSessionManager(projects, policy, records, NewObjectives(store), nil)
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "fixture", "test", manager)
	defer client.Close()
	defer func() {
		select {
		case releaseUpstream <- struct{}{}:
		default:
		}
	}()
	manager.SetClient(client)
	generation, err := client.Ready(ctx)
	if err != nil {
		t.Fatal(err)
	}
	entry := newSessionEntry("chat", project.ID, project.Roots[0], "", "")
	entry.attached = generation
	entry.appAttachments = map[string]appAttachmentState{"origin": {attachment: testAppViewAttachment}}
	manager.mu.Lock()
	manager.sessions["chat"] = entry
	manager.mu.Unlock()

	firstDone := make(chan error, 1)
	go func() {
		_, err := manager.ReadAppResource(ctx, project.ID, "chat", "origin", testAppViewAttachment, "ui://apps/fixture")
		firstDone <- err
	}()
	select {
	case <-upstreamStarted:
	case <-ctx.Done():
		t.Fatal("first session operation did not reach Goose")
	}

	views := NewAppViews(manager, AuthConfig{}, DefaultControllerPort)
	defer views.CloseAll(context.Background())
	viewID := strings.Repeat("a", 64)
	if err := views.registerView(viewID, project.ID, "chat", "origin", "client", testAppViewAttachment, "<p>fixture</p>", time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	queuedDone := make(chan error, 1)
	go func() {
		_, err := views.ReadResource(ctx, viewID, "queued", project.ID, "chat", "origin", "ui://apps/fixture", "client")
		queuedDone <- err
	}()
	for {
		views.mu.Lock()
		active := views.activeOperations
		views.mu.Unlock()
		if active == 1 {
			break
		}
		select {
		case err := <-queuedDone:
			t.Fatalf("queued App operation settled before cancellation: %v", err)
		case <-ctx.Done():
			t.Fatal("queued App operation did not reserve its slot")
		case <-time.After(time.Millisecond):
		}
	}
	if err := views.CancelOperation(viewID, "queued", "client"); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-queuedDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled App operation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled App operation retained its slot behind the session operation")
	}
	views.mu.Lock()
	active := views.activeOperations
	views.mu.Unlock()
	if active != 0 {
		t.Fatalf("canceled App operation retained %d global slots", active)
	}
	select {
	case err := <-firstDone:
		t.Fatalf("blocking Goose operation settled before release: %v", err)
	default:
	}

	releaseUpstream <- struct{}{}
	if err := <-firstDone; err != nil {
		t.Fatalf("blocking Goose operation: %v", err)
	}
}

func TestAppOperationsStayBoundToTrustedToolAttachment(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	root := t.TempDir()
	policy, err := NewPathPolicy([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	store := Store{Dir: t.TempDir()}
	projects := NewProjects(store, policy)
	project, err := projects.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	records := NewSessionRecords(store)
	if err := records.Record(ProjectSessionRecord{ProjectID: project.ID, SessionID: "chat", CWD: project.Roots[0]}); err != nil {
		t.Fatal(err)
	}
	type upstreamCall struct {
		method string
		params map[string]any
	}
	calls := make(chan upstreamCall, 8)
	nextCall := func() upstreamCall {
		t.Helper()
		select {
		case call := <-calls:
			return call
		case <-ctx.Done():
			t.Fatal("timed out waiting for Goose App operation")
			return upstreamCall{}
		}
	}
	var serveAppResource atomic.Bool
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
			switch rpc.Method {
			case "initialize":
				result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}, "authMethods": []any{}}
			case "_goose/unstable/resources/read":
				calls <- upstreamCall{method: rpc.Method, params: rpc.Params}
				content := map[string]any{"uri": rpc.Params["uri"], "mimeType": "text/plain", "text": "fixture"}
				if serveAppResource.Load() && rpc.Params["uri"] == "ui://apps/fixture" {
					content = map[string]any{
						"uri": "ui://apps/fixture", "mimeType": appViewMediaType, "text": "<!doctype html><title>Fixture</title>",
						"_meta": map[string]any{"ui": map[string]any{
							"csp":         map[string]any{"connectDomains": []any{"https://api.example"}},
							"permissions": map[string]any{"clipboardWrite": map[string]any{}},
							"ignored":     "not projected",
						}},
					}
				}
				result = map[string]any{"result": map[string]any{"contents": []any{content}}}
			case "_goose/unstable/tools/call":
				calls <- upstreamCall{method: rpc.Method, params: rpc.Params}
				result = map[string]any{
					"content":           []any{map[string]any{"type": "text", "text": "done"}},
					"structuredContent": map[string]any{"saved": true},
					"isError":           false,
					"_meta":             map[string]any{"forApp": "retained"},
				}
			}
			if len(rpc.ID) > 0 && writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result}) != nil {
				return
			}
		}
	}))
	defer server.Close()
	manager := NewSessionManager(projects, policy, records, NewObjectives(store), nil)
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "fixture", "test", manager)
	defer client.Close()
	manager.SetClient(client)
	generation, err := client.Ready(ctx)
	if err != nil {
		t.Fatal(err)
	}
	entry := newSessionEntry("chat", project.ID, project.Roots[0], "", "")
	entry.attached = generation
	entry.appAttachments = map[string]appAttachmentState{"origin": {attachment: AppAttachment{
		ToolName: "apps__create_app", ExtensionName: "apps", ResourceURI: "ui://apps/fixture",
	}}}
	manager.mu.Lock()
	manager.sessions["chat"] = entry
	manager.mu.Unlock()
	attachment := entry.appAttachments["origin"].attachment
	handler := CoreHandler{Sessions: manager}
	invoke := func(method string, params map[string]any) (any, error) {
		t.Helper()
		raw, err := json.Marshal(params)
		if err != nil {
			t.Fatal(err)
		}
		return handler.Handle(ctx, method, raw, "browser")
	}
	readResource := func(params map[string]any) (any, error) {
		t.Helper()
		return manager.ReadAppResource(ctx, params["projectId"].(string), params["sessionId"].(string), params["toolCallId"].(string), attachment, params["uri"].(string))
	}
	callTool := func(params map[string]any) (any, error) {
		t.Helper()
		return manager.CallAppTool(ctx, params["projectId"].(string), params["sessionId"].(string), params["toolCallId"].(string), attachment, params["name"].(string), mapValue(params["arguments"]))
	}
	base := map[string]any{"projectId": project.ID, "sessionId": "chat", "toolCallId": "origin", "extensionName": "untrusted"}
	secondary := cloneJSON(base).(map[string]any)
	secondary["uri"] = "app://fixture/later"
	initial := cloneJSON(base).(map[string]any)
	initial["uri"] = "ui://apps/fixture"
	result, err := readResource(initial)
	if err != nil || len(arrayValue(mapValue(result)["contents"])) != 1 {
		t.Fatalf("initial resource result %#v, error %v", result, err)
	}
	first := nextCall()
	if first.method != "_goose/unstable/resources/read" || first.params["extensionName"] != "apps" || first.params["uri"] != "ui://apps/fixture" {
		t.Fatalf("resource authority escaped attachment: %#v", first)
	}
	result, err = readResource(secondary)
	if err != nil || mapValue(arrayValue(mapValue(result)["contents"])[0])["uri"] != "app://fixture/later" {
		t.Fatalf("secondary resource result %#v, error %v", result, err)
	}
	second := nextCall()
	if second.params["extensionName"] != "apps" || second.params["uri"] != "app://fixture/later" {
		t.Fatalf("secondary resource changed extension: %#v", second)
	}
	tool := cloneJSON(base).(map[string]any)
	tool["name"] = "save"
	tool["arguments"] = map[string]any{"value": "fixture"}
	result, err = callTool(tool)
	if err != nil || mapValue(result)["isError"] != false || mapValue(mapValue(result)["_meta"])["forApp"] != "retained" {
		t.Fatalf("tool result %#v, error %v", result, err)
	}
	third := nextCall()
	if third.method != "_goose/unstable/tools/call" || third.params["name"] != "apps__save" || !reflect.DeepEqual(third.params["arguments"], map[string]any{"value": "fixture"}) {
		t.Fatalf("tool authority escaped attachment: %#v", third)
	}
	qualified := cloneJSON(tool).(map[string]any)
	qualified["name"] = "apps__save"
	if _, err := callTool(qualified); err != nil {
		t.Fatalf("same-extension qualified tool was rejected: %v", err)
	}
	fourth := nextCall()
	if fourth.params["name"] != "apps__save" {
		t.Fatalf("qualified tool was prefixed twice: %#v", fourth)
	}
	crossExtension := cloneJSON(tool).(map[string]any)
	crossExtension["name"] = "other__save"
	if _, err := callTool(crossExtension); err == nil {
		t.Fatal("called an App tool through another extension")
	}
	unknown := cloneJSON(tool).(map[string]any)
	unknown["toolCallId"] = "missing"
	if _, err := callTool(unknown); err == nil {
		t.Fatal("called an App tool without a trusted attachment")
	}
	wrongProject := cloneJSON(tool).(map[string]any)
	wrongProject["projectId"] = "another-project"
	if _, err := callTool(wrongProject); err == nil {
		t.Fatal("called an App tool through another project")
	}

	ticket := strings.Repeat("a", 64)
	secondTicket := strings.Repeat("b", 64)
	malformedTicket := strings.Repeat("c", 64)
	tickets := []string{ticket, secondTicket, malformedTicket}
	var ticketIndex atomic.Int32
	type browserCall struct {
		method, path, authorization, contentType, cookie string
		entryUnlocked                                    bool
		body                                             map[string]any
	}
	browserCalls := make(chan browserCall, 8)
	browserServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		call := browserCall{method: request.Method, path: request.URL.Path, authorization: request.Header.Get("Authorization"), contentType: request.Header.Get("Content-Type"), cookie: request.Header.Get("Cookie")}
		call.entryUnlocked = entry.op.TryLock()
		if call.entryUnlocked {
			entry.op.Unlock()
		}
		if request.Body != nil {
			body, _ := io.ReadAll(request.Body)
			_ = json.Unmarshal(body, &call.body)
		}
		browserCalls <- call
		response.Header().Set("Content-Type", "application/json")
		if request.Method == http.MethodPost {
			index := int(ticketIndex.Add(1) - 1)
			if index >= len(tickets) {
				response.WriteHeader(http.StatusTooManyRequests)
				return
			}
			registeredTicket := tickets[index]
			registeredPath := appViewPath + "/" + registeredTicket
			if index == 2 {
				registeredPath += "-unexpected"
			}
			response.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"ticket": registeredTicket, "path": registeredPath,
				"url":       "https://sandbox.example" + registeredPath,
				"expiresAt": time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano),
			})
			return
		}
		_ = json.NewEncoder(response).Encode(map[string]bool{"ok": true})
	}))
	defer browserServer.Close()
	token := "browser-token-0123456789abcdef0123456789"
	handler.Apps = NewAppViews(manager, AuthConfig{
		BrowserEnabled: true, BrowserToken: token, BrowserURL: browserServer.URL,
		BrowserPublicOrigin: "https://sandbox.example", PublicOrigin: "https://gooseberry.example",
	}, DefaultControllerPort)

	open := cloneJSON(base).(map[string]any)
	open["parentOrigin"] = "https://other.example"
	if _, err := invoke("session.appOpen", open); err == nil {
		t.Fatal("opened an App for an untrusted parent origin")
	}
	select {
	case call := <-browserCalls:
		t.Fatalf("untrusted origin reached the browser service: %#v", call)
	default:
	}

	serveAppResource.Store(true)
	open["parentOrigin"] = "https://gooseberry.example"
	openedValue, err := invoke("session.appOpen", open)
	if err != nil {
		t.Fatalf("open App: %v", err)
	}
	opened, ok := openedValue.(AppViewOpenResult)
	appHTML := "<!doctype html><title>Fixture</title>"
	if !ok || opened.ViewID != ticket || opened.URL != "https://sandbox.example"+appViewPath+"/"+ticket || opened.Resource.ByteLength != len(appHTML) {
		t.Fatalf("unexpected open result: %#v", openedValue)
	}
	openWire, err := json.Marshal(opened)
	if err != nil || strings.Contains(string(openWire), `"html"`) || len(openWire) > maxAppViewResponseBytes {
		t.Fatalf("App open response retained resource HTML: %d bytes, %s, %v", len(openWire), openWire, err)
	}
	if !reflect.DeepEqual(opened.Resource.CSP, map[string]any{"connectDomains": []any{"https://api.example"}}) || !reflect.DeepEqual(opened.Resource.Permissions, map[string]any{"clipboardWrite": map[string]any{}}) {
		t.Fatalf("unexpected projected policy: %#v", opened.Resource)
	}
	fifth := nextCall()
	if fifth.method != "_goose/unstable/resources/read" || fifth.params["extensionName"] != "apps" || fifth.params["uri"] != "ui://apps/fixture" {
		t.Fatalf("open resource read escaped attachment: %#v", fifth)
	}
	registered := <-browserCalls
	if registered.method != http.MethodPost || registered.path != appViewPath || registered.authorization != "Bearer "+token || registered.contentType != "application/json" || registered.cookie != "" || !registered.entryUnlocked {
		t.Fatalf("unexpected browser registration: %#v", registered)
	}
	expectedRegistration := map[string]any{
		"parentOrigin": "https://gooseberry.example",
		"csp":          map[string]any{"connectDomains": []any{"https://api.example"}},
		"permissions":  map[string]any{"clipboardWrite": map[string]any{}},
	}
	if !reflect.DeepEqual(registered.body, expectedRegistration) {
		t.Fatalf("browser received unprojected metadata: %#v", registered.body)
	}
	contentRequest := cloneJSON(base).(map[string]any)
	contentRequest["viewId"] = ticket
	contentRequest["offset"] = 0
	contentValue, err := invoke("session.appContentRead", contentRequest)
	if err != nil {
		t.Fatalf("read retained App content: %v", err)
	}
	content := contentValue.(appViewContentChunk)
	decodedContent, err := base64.StdEncoding.DecodeString(content.Data)
	if err != nil || string(decodedContent) != appHTML || content.NextOffset != len(appHTML) {
		t.Fatalf("unexpected retained App content: %#v, %q, %v", content, decodedContent, err)
	}
	entry.op.Lock()
	projectAppAttachment(entry, "origin", map[string]any{"_meta": map[string]any{"goose": map[string]any{"mcpApp": map[string]any{
		"toolName": "apps__create_app", "toolNameIsActual": true, "extensionName": "apps", "resourceUri": "ui://apps/fixture",
	}}}})
	entry.op.Unlock()
	boundSecondary := cloneJSON(secondary).(map[string]any)
	boundSecondary["viewId"] = ticket
	boundSecondary["operationId"] = "secondary-after-reprojection"
	result, err = invoke("session.appResourceRead", boundSecondary)
	if err != nil || mapValue(arrayValue(mapValue(result)["contents"])[0])["uri"] != "app://fixture/later" {
		t.Fatalf("bound secondary resource after attachment reprojection %#v, error %v", result, err)
	}
	reprojectedCall := nextCall()
	if reprojectedCall.method != "_goose/unstable/resources/read" || reprojectedCall.params["uri"] != "app://fixture/later" {
		t.Fatalf("attachment reprojection broke the open view: %#v", reprojectedCall)
	}
	boundTool := cloneJSON(tool).(map[string]any)
	boundTool["viewId"] = ticket
	boundTool["operationId"] = "bound-operation"
	result, err = invoke("session.appToolCall", boundTool)
	if err != nil || mapValue(result)["isError"] != false {
		t.Fatalf("bound App tool result %#v, error %v", result, err)
	}
	boundCall := nextCall()
	if boundCall.method != "_goose/unstable/tools/call" || boundCall.params["name"] != "apps__save" {
		t.Fatalf("bound App tool escaped attachment: %#v", boundCall)
	}
	entry.state.Lock()
	changedAttachment := entry.appAttachments["origin"]
	changedAttachment.attachment.ExtensionName = "other"
	entry.appAttachments["origin"] = changedAttachment
	entry.state.Unlock()
	staleTool := cloneJSON(boundTool).(map[string]any)
	staleTool["operationId"] = "stale-view-operation"
	if _, err := invoke("session.appToolCall", staleTool); err == nil {
		t.Fatal("view inherited a replacement App attachment")
	}
	entry.state.Lock()
	changedAttachment.attachment = attachment
	entry.appAttachments["origin"] = changedAttachment
	entry.state.Unlock()
	openedValue, err = invoke("session.appOpen", open)
	if err != nil {
		t.Fatalf("reopen App: %v", err)
	}
	reopened, ok := openedValue.(AppViewOpenResult)
	if !ok || reopened.ViewID != secondTicket || reopened.Resource.ByteLength != len(appHTML) {
		t.Fatalf("unexpected reopened App: %#v", openedValue)
	}
	reopenCall := nextCall()
	if reopenCall.method != "_goose/unstable/resources/read" || reopenCall.params["extensionName"] != "apps" || reopenCall.params["uri"] != "ui://apps/fixture" {
		t.Fatalf("reopen reused a retained resource: %#v", reopenCall)
	}
	registered = <-browserCalls
	if registered.method != http.MethodPost || registered.path != appViewPath || !registered.entryUnlocked {
		t.Fatalf("unexpected repeated browser registration: %#v", registered)
	}
	if _, err := invoke("session.appClose", map[string]any{"viewId": ticket}); err != nil {
		t.Fatalf("close App: %v", err)
	}
	closed := <-browserCalls
	if closed.method != http.MethodDelete || closed.path != appViewPath+"/"+ticket || closed.authorization != "Bearer "+token {
		t.Fatalf("unexpected browser close: %#v", closed)
	}
	if _, err := invoke("session.appClose", map[string]any{"viewId": secondTicket}); err != nil {
		t.Fatalf("close reopened App: %v", err)
	}
	closed = <-browserCalls
	if closed.method != http.MethodDelete || closed.path != appViewPath+"/"+secondTicket {
		t.Fatalf("unexpected reopened browser close: %#v", closed)
	}
	if _, err := invoke("session.appClose", map[string]any{"viewId": "not-a-ticket"}); err == nil {
		t.Fatal("closed an invalid App view ticket")
	}
	if _, err := invoke("session.appOpen", open); err == nil {
		t.Fatal("opened an App from a malformed browser registration")
	}
	malformedRootRead := nextCall()
	if malformedRootRead.method != "_goose/unstable/resources/read" {
		t.Fatalf("malformed registration skipped root validation: %#v", malformedRootRead)
	}
	malformedRegistration := <-browserCalls
	malformedCleanup := <-browserCalls
	if malformedRegistration.method != http.MethodPost || malformedCleanup.method != http.MethodDelete || malformedCleanup.path != appViewPath+"/"+malformedTicket {
		t.Fatalf("known ticket from malformed registration was not revoked: registration=%#v cleanup=%#v", malformedRegistration, malformedCleanup)
	}
	select {
	case unexpected := <-calls:
		t.Fatalf("rejected request reached Goose: %#v", unexpected)
	default:
	}
}

func TestAppViewParentOriginFallsBackToControllerLoopback(t *testing.T) {
	views := NewAppViews(nil, AuthConfig{}, DefaultControllerPort)
	for origin, valid := range map[string]bool{
		"http://127.0.0.1:7312":   true,
		"http://localhost:7312":   true,
		"http://[::1]:7312":       true,
		"http://127.0.0.1:7313":   false,
		"https://127.0.0.1:7312":  false,
		"http://example.com:7312": false,
	} {
		t.Run(origin, func(t *testing.T) {
			_, err := views.expectedParentOrigin(origin)
			if (err == nil) != valid {
				t.Fatalf("origin validity %v, error %v", valid, err)
			}
		})
	}
}

func TestAppViewRootResourceAcceptsExactTextAndBlob(t *testing.T) {
	content := func(value map[string]any) map[string]any {
		value["uri"] = "ui://apps/fixture"
		value["mimeType"] = appViewMediaType
		return map[string]any{"contents": []any{value}}
	}
	for name, test := range map[string]struct {
		result map[string]any
		want   string
		valid  bool
	}{
		"text":               {result: content(map[string]any{"text": "<p>text</p>"}), want: "<p>text</p>", valid: true},
		"blob":               {result: content(map[string]any{"blob": base64.StdEncoding.EncodeToString([]byte("<p>blob</p>"))}), want: "<p>blob</p>", valid: true},
		"malformed blob":     {result: content(map[string]any{"blob": "Zm9v\n"})},
		"invalid UTF-8 text": {result: content(map[string]any{"text": string([]byte{0xff})})},
	} {
		t.Run(name, func(t *testing.T) {
			resource, err := appViewRootResource("ui://apps/fixture", test.result)
			if (err == nil) != test.valid || test.valid && resource.HTML != test.want {
				t.Fatalf("resource %#v, error %v", resource, err)
			}
		})
	}
	duplicate := content(map[string]any{"text": "one"})
	duplicate["contents"] = append(arrayValue(duplicate["contents"]), map[string]any{
		"uri": "ui://apps/fixture", "mimeType": appViewMediaType, "text": "two",
	})
	if _, err := appViewRootResource("ui://apps/fixture", duplicate); err == nil {
		t.Fatal("accepted ambiguous root resources")
	}
}
