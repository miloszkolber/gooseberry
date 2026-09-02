package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestCanonicalLookupsShareWorkWithoutReleasingActiveSlots(t *testing.T) {
	started := make(chan string, 16)
	release := make(chan struct{})
	var requests atomic.Int32
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
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
			if rpc.Method == "initialize" {
				_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": testGooseInitializeResponse()})
			} else if rpc.Method == "_goose/unstable/providers/canonical-model-info" {
				requests.Add(1)
				model := textValue(rpc.Params["model"])
				started <- model
				go func(id json.RawMessage) {
					<-release
					_ = writeTestRPC(connection, map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{"modelInfo": map[string]any{"provider": "fixture", "model": model, "contextLimit": 8192, "reasoning": true, "currency": "USD"}}})
				}(rpc.ID)
			}
		}
	}))
	defer server.Close()
	client := NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "fixture", "test", nil)
	defer client.Close()
	defer unblock()
	admin := NewGooseAdmin(client, NewSettings(Store{Dir: t.TempDir()}, nil))
	defer admin.logins.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	lookup := func(ctx context.Context, model string) <-chan *canonicalModelInfo {
		result := make(chan *canonicalModelInfo, 1)
		go func() { result <- admin.canonicalModel(ctx, "fixture", model) }()
		return result
	}
	waitFor := func(condition func() bool) {
		t.Helper()
		ticker := time.NewTicker(time.Millisecond)
		defer ticker.Stop()
		for !condition() {
			select {
			case <-ticker.C:
			case <-ctx.Done():
				t.Fatal("lookup did not reach expected state")
			}
		}
	}
	expectStart := func(model string) {
		t.Helper()
		select {
		case actual := <-started:
			if actual != model {
				t.Fatalf("expected %q, started %q", model, actual)
			}
		case <-ctx.Done():
			t.Fatal("lookup did not start")
		}
	}
	waitResult := func(result <-chan *canonicalModelInfo) *canonicalModelInfo {
		t.Helper()
		select {
		case value := <-result:
			return value
		case <-ctx.Done():
			t.Fatal("lookup did not return")
			return nil
		}
	}
	firstContext, cancelFirst := context.WithCancel(ctx)
	defer cancelFirst()
	first := lookup(firstContext, "shared")
	expectStart("shared")
	second := lookup(ctx, "shared")
	waitFor(func() bool {
		admin.canonicalMu.Lock()
		defer admin.canonicalMu.Unlock()
		for key, flight := range admin.canonicalFlights {
			if key.model == "shared" {
				return flight.consumers == 2
			}
		}
		return false
	})
	cancelFirst()
	if waitResult(first) != nil {
		t.Fatal("cancelled consumer returned metadata")
	}
	for _, model := range []string{"two", "three", "four"} {
		consumer, cancelConsumer := context.WithCancel(ctx)
		result := lookup(consumer, model)
		expectStart(model)
		cancelConsumer()
		if waitResult(result) != nil {
			t.Fatal("cancelled consumer returned metadata")
		}
	}
	queuedContext, cancelQueued := context.WithCancel(ctx)
	defer cancelQueued()
	queued := lookup(queuedContext, "queued")
	waitFor(func() bool {
		admin.canonicalMu.Lock()
		defer admin.canonicalMu.Unlock()
		for key, flight := range admin.canonicalFlights {
			if key.model == "queued" {
				return !flight.started
			}
		}
		return false
	})
	cancelQueued()
	if waitResult(queued) != nil || requests.Load() != 4 || len(admin.canonicalSlots) != 4 {
		t.Fatal("consumer cancellation released an active slot or started unused work")
	}
	unblock()
	if value := waitResult(second); value == nil || value.Model != "shared" || value.ContextLimit == nil || *value.ContextLimit != 8192 {
		t.Fatalf("shared lookup result: %#v", value)
	}
	waitFor(func() bool {
		admin.canonicalMu.Lock()
		defer admin.canonicalMu.Unlock()
		return len(admin.canonicalFlights) == 0
	})
	if value := admin.canonicalModel(ctx, "fixture", "shared"); value == nil || requests.Load() != 5 {
		t.Fatal("completed metadata was cached or cancelled queued work reached Goose")
	}
}
