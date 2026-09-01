package controller

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var testAppViewAttachment = AppAttachment{
	ToolName: "apps__create_app", ExtensionName: "apps", ResourceURI: "ui://apps/fixture",
}

func registerTestAppView(t *testing.T, views *AppViews, viewID, clientKey string) {
	t.Helper()
	if err := views.registerView(viewID, "project", "session", "tool-call", clientKey, testAppViewAttachment, "fixture", time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
}

func TestAppViewCloseCancelsOperationsBeforeBrowserDelete(t *testing.T) {
	operationReady := make(chan context.Context, 1)
	deleted := make(chan bool, 1)
	browser := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		operationContext := <-operationReady
		deleted <- operationContext.Err() != nil
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]bool{"ok": true})
	}))
	defer browser.Close()

	views := NewAppViews(nil, AuthConfig{
		BrowserEnabled: true,
		BrowserToken:   "browser-token-0123456789abcdef0123456789",
		BrowserURL:     browser.URL,
	}, DefaultControllerPort)
	viewID := strings.Repeat("a", 64)
	registerTestAppView(t, views, viewID, "client")
	operationContext, _, finish, err := views.beginOperation(context.Background(), viewID, "operation", "project", "session", "tool-call", "client")
	if err != nil {
		t.Fatal(err)
	}
	operationReady <- operationContext
	if err := views.Close(context.Background(), viewID, "client"); err != nil {
		t.Fatal(err)
	}
	if !<-deleted {
		t.Fatal("browser view was deleted before its controller operation was canceled")
	}
	views.mu.Lock()
	active := views.activeOperations
	views.mu.Unlock()
	if active != 1 {
		t.Fatalf("closed operation released its global slot before settling: %d", active)
	}
	finish()
	views.mu.Lock()
	active = views.activeOperations
	views.mu.Unlock()
	if active != 0 {
		t.Fatalf("settled operation retained its global slot: %d", active)
	}
}

func TestAppViewOperationLimitsRemainBoundedWhileCancellationSettles(t *testing.T) {
	views := NewAppViews(nil, AuthConfig{}, DefaultControllerPort)
	tickets := make([]string, 0, maxAppViews)
	for index := 0; index < maxAppViews; index++ {
		viewID := fmt.Sprintf("%064x", index+1)
		tickets = append(tickets, viewID)
		registerTestAppView(t, views, viewID, "client")
	}
	if err := views.registerView(strings.Repeat("f", 64), "project", "session", "tool-call", "client", testAppViewAttachment, "fixture", time.Now().Add(time.Minute)); err == nil {
		t.Fatal("registered more than the bounded number of App views")
	}
	finishes := make([]func(), 0, maxAppOperations)
	for viewIndex := 0; viewIndex < 4; viewIndex++ {
		for operationIndex := 0; operationIndex < maxAppViewOperations; operationIndex++ {
			_, _, finish, err := views.beginOperation(
				context.Background(), tickets[viewIndex], fmt.Sprintf("operation-%d-%d", viewIndex, operationIndex),
				"project", "session", "tool-call", "client",
			)
			if err != nil {
				t.Fatal(err)
			}
			finishes = append(finishes, finish)
		}
	}
	if _, _, _, err := views.beginOperation(context.Background(), tickets[0], "fifth", "project", "session", "tool-call", "client"); err == nil {
		t.Fatal("started a fifth operation in one App view")
	}
	if _, err := views.revokeView(tickets[0], "client"); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := views.beginOperation(context.Background(), tickets[4], "global-overflow", "project", "session", "tool-call", "client"); err == nil {
		t.Fatal("canceled but unsettled operations released the global limit")
	}
	for _, finish := range finishes[:maxAppViewOperations] {
		finish()
	}
	_, _, replacementFinish, err := views.beginOperation(context.Background(), tickets[4], "replacement", "project", "session", "tool-call", "client")
	if err != nil {
		t.Fatalf("settled operations did not release capacity: %v", err)
	}
	replacementFinish()
	for _, finish := range finishes[maxAppViewOperations:] {
		finish()
	}
}

func TestAppViewOperationsRejectCrossBindingAccess(t *testing.T) {
	views := NewAppViews(nil, AuthConfig{}, DefaultControllerPort)
	viewID := strings.Repeat("a", 64)
	registerTestAppView(t, views, viewID, "client")
	for name, binding := range map[string][4]string{
		"project": {"other", "session", "tool-call", "client"},
		"session": {"project", "other", "tool-call", "client"},
		"tool":    {"project", "session", "other", "client"},
		"client":  {"project", "session", "tool-call", "other"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, _, err := views.beginOperation(context.Background(), viewID, "operation-"+name, binding[0], binding[1], binding[2], binding[3]); err == nil {
				t.Fatal("cross-binding App operation was accepted")
			}
		})
	}
}

func TestAppViewEarlyCancellationIsConsumedAndBounded(t *testing.T) {
	views := NewAppViews(nil, AuthConfig{}, DefaultControllerPort)
	viewID := strings.Repeat("a", 64)
	registerTestAppView(t, views, viewID, "client")
	activeContext, _, activeFinish, err := views.beginOperation(context.Background(), viewID, "active", "project", "session", "tool-call", "client")
	if err != nil {
		t.Fatal(err)
	}
	if err := views.CancelOperation(viewID, "active", "client"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-activeContext.Done():
	case <-time.After(time.Second):
		t.Fatal("active App operation was not canceled")
	}
	activeFinish()
	if err := views.CancelOperation(viewID, "early", "client"); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := views.beginOperation(context.Background(), viewID, "early", "project", "session", "tool-call", "client"); !errors.Is(err, context.Canceled) {
		t.Fatalf("early cancellation result: %v", err)
	}
	_, _, finish, err := views.beginOperation(context.Background(), viewID, "early", "project", "session", "tool-call", "client")
	if err != nil {
		t.Fatalf("consumed cancellation affected a later operation: %v", err)
	}
	finish()

	for index := 0; index < maxEarlyAppOperationCancels+10; index++ {
		if err := views.CancelOperation(viewID, fmt.Sprintf("queued-%d", index), "client"); err != nil {
			t.Fatal(err)
		}
	}
	views.mu.Lock()
	defer views.mu.Unlock()
	if len(views.earlyCancels) != maxEarlyAppOperationCancels || len(views.earlyCancelOrder) != maxEarlyAppOperationCancels {
		t.Fatalf("early cancellation set grew beyond its bound: %d/%d", len(views.earlyCancels), len(views.earlyCancelOrder))
	}
}

func TestAppViewClientReleaseIsScoped(t *testing.T) {
	views := NewAppViews(nil, AuthConfig{}, DefaultControllerPort)
	firstID := strings.Repeat("a", 64)
	secondID := strings.Repeat("b", 64)
	registerTestAppView(t, views, firstID, "first-client")
	registerTestAppView(t, views, secondID, "second-client")
	firstContext, _, firstFinish, err := views.beginOperation(context.Background(), firstID, "first-operation", "project", "session", "tool-call", "first-client")
	if err != nil {
		t.Fatal(err)
	}
	secondContext, _, secondFinish, err := views.beginOperation(context.Background(), secondID, "second-operation", "project", "session", "tool-call", "second-client")
	if err != nil {
		t.Fatal(err)
	}

	views.ReleaseClient("first-client")
	select {
	case <-firstContext.Done():
	case <-time.After(time.Second):
		t.Fatal("released client retained its App operation")
	}
	if secondContext.Err() != nil {
		t.Fatal("releasing one client canceled another client's App operation")
	}
	if _, _, _, err := views.beginOperation(context.Background(), firstID, "after-release", "project", "session", "tool-call", "first-client"); err == nil {
		t.Fatal("released client retained its App view")
	}
	firstFinish()

	if secondContext.Err() != nil {
		t.Fatal("releasing one client canceled another client's App operation")
	}
	secondFinish()
	views.CloseAll(context.Background())
}

func TestAppViewTicketExpiryDoesNotRevokeLoadedView(t *testing.T) {
	views := NewAppViews(nil, AuthConfig{}, DefaultControllerPort)
	viewID := strings.Repeat("a", 64)
	ticketExpiresAt := time.Now().Add(100 * time.Millisecond)
	if err := views.registerView(viewID, "project", "session", "tool-call", "client", testAppViewAttachment, "fixture", ticketExpiresAt); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Until(ticketExpiresAt) + 10*time.Millisecond)
	_, _, finish, err := views.beginOperation(context.Background(), viewID, "after-ticket-expiry", "project", "session", "tool-call", "client")
	if err != nil {
		t.Fatalf("loaded App lost controller authority when its browser ticket expired: %v", err)
	}
	finish()
}

func TestAppViewContentIsBoundedScopedAndReleased(t *testing.T) {
	worstChunk := appViewContentChunk{
		Offset: 0, Data: base64.StdEncoding.EncodeToString(make([]byte, maxAppViewContentChunkBytes)),
		NextOffset: maxAppViewContentChunkBytes,
	}
	wireChunk, err := json.Marshal(map[string]any{"id": strings.Repeat("r", 32), "ok": true, "result": worstChunk})
	if err != nil {
		t.Fatal(err)
	}
	if len(wireChunk)*maxAppViews >= NewReplayCache().maxWeight {
		t.Fatalf("one content chunk for each App view exceeds replay capacity: %d bytes", len(wireChunk)*maxAppViews)
	}

	views := NewAppViews(nil, AuthConfig{}, DefaultControllerPort)
	views.maxContentBytes = 10
	firstID := strings.Repeat("a", 64)
	secondID := strings.Repeat("b", 64)
	if err := views.registerView(firstID, "project", "session", "tool-call", "client", testAppViewAttachment, "123456", time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := views.registerView(secondID, "project", "session", "tool-call", "client", testAppViewAttachment, "12345", time.Now().Add(time.Minute)); err == nil {
		t.Fatal("registered App content beyond the global byte budget")
	}
	if _, err := views.Content(firstID, "other", "session", "tool-call", "client", 0); err == nil {
		t.Fatal("read App content across a project binding")
	}
	value, err := views.Content(firstID, "project", "session", "tool-call", "client", 0)
	if err != nil {
		t.Fatal(err)
	}
	chunk := value.(appViewContentChunk)
	decoded, err := base64.StdEncoding.DecodeString(chunk.Data)
	if err != nil || string(decoded) != "123456" || chunk.Offset != 0 || chunk.NextOffset != 6 {
		t.Fatalf("unexpected App content chunk: %#v, %q, %v", chunk, decoded, err)
	}
	views.mu.Lock()
	contentBytes := views.contentBytes
	views.mu.Unlock()
	if contentBytes != 0 {
		t.Fatalf("final App content chunk retained %d controller bytes", contentBytes)
	}
	if err := views.registerView(secondID, "project", "session", "tool-call", "client", testAppViewAttachment, "12345", time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("delivered content did not release capacity: %v", err)
	}
	views.CloseAll(context.Background())
}

func TestAppViewLeaseRenewsThenExpiresAbandonedView(t *testing.T) {
	deleted := make(chan struct{}, 1)
	browser := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodDelete {
			deleted <- struct{}{}
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]bool{"ok": true})
	}))
	defer browser.Close()

	views := NewAppViews(nil, AuthConfig{
		BrowserEnabled: true,
		BrowserToken:   "browser-token-0123456789abcdef0123456789",
		BrowserURL:     browser.URL,
	}, DefaultControllerPort)
	views.viewLease = time.Hour
	viewID := strings.Repeat("a", 64)
	registerTestAppView(t, views, viewID, "client")
	if err := views.KeepAlive(viewID, "project", "session", "tool-call", "client"); err != nil {
		t.Fatal(err)
	}
	views.mu.Lock()
	view := views.views[viewID]
	renewedUntil := view.leaseUntil
	views.mu.Unlock()
	if time.Until(renewedUntil) < 59*time.Minute {
		t.Fatalf("App lease was not renewed: %v", renewedUntil)
	}
	views.expireView(viewID, view)
	_, _, finish, err := views.beginOperation(context.Background(), viewID, "renewed", "project", "session", "tool-call", "client")
	if err != nil {
		t.Fatalf("renewed App lease expired before its deadline: %v", err)
	}
	finish()
	select {
	case <-deleted:
		t.Fatal("renewed App view was deleted before its deadline")
	default:
	}
	views.mu.Lock()
	view.leaseUntil = time.Now().Add(-time.Second)
	views.mu.Unlock()
	if err := views.KeepAlive(viewID, "project", "session", "tool-call", "client"); err == nil {
		t.Fatal("renewed an App view after its lease deadline")
	}
	views.expireView(viewID, view)
	select {
	case <-deleted:
	case <-time.After(time.Second):
		t.Fatal("abandoned App view lease did not expire")
	}
	if _, _, _, err := views.beginOperation(context.Background(), viewID, "expired", "project", "session", "tool-call", "client"); err == nil {
		t.Fatal("expired App view retained operation authority")
	}
	views.mu.Lock()
	contentBytes := views.contentBytes
	views.mu.Unlock()
	if contentBytes != 0 {
		t.Fatalf("expired App view retained %d content bytes", contentBytes)
	}
	views.CloseAll(context.Background())
}
