package controller_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/miloszkolber/gooseberry/internal/controller"
	"github.com/miloszkolber/gooseberry/internal/persist"
)

func TestGooseSchedulerAutomationMapsRequestsAndNormalizesResponses(t *testing.T) {
	type request struct {
		method string
		params map[string]any
	}
	requests := make(chan request, 16)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, r *http.Request) {
		connection, err := websocket.Accept(response, r, nil)
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
				Params map[string]any  `json:"params"`
			}
			if json.Unmarshal(payload, &rpc) != nil {
				return
			}
			if rpc.Method == "initialize" {
				_ = writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": gooseInitializeResponse()})
				continue
			}
			requests <- request{method: rpc.Method, params: rpc.Params}
			result := map[string]any{}
			switch rpc.Method {
			case "_goose/unstable/schedules/list":
				result["jobs"] = []any{map[string]any{"id": "job-1", "source": "recipe.md", "cron": "0 * * * *", "paused": true, "currentlyRunning": false, "lastRun": "2026-09-03T00:00:00Z"}}
			case "_goose/unstable/schedules/create", "_goose/unstable/schedules/update":
				result["job"] = map[string]any{"id": "job-1", "source": "recipe.md", "cron": rpc.Params["cron"], "paused": false, "currentlyRunning": true}
			case "_goose/unstable/schedules/sessions/list":
				result["sessions"] = []any{map[string]any{"sessionId": "session-1", "archived": true, "_meta": map[string]any{"createdAt": "2026-09-03T00:00:00Z"}}}
			case "_goose/unstable/schedules/running-job/inspect":
				result = map[string]any{"running": true, "sessionId": "session-1", "jobStartTime": "2026-09-03T00:00:00Z", "runningDurationSeconds": 12}
			case "_goose/unstable/schedules/run-now":
				result = map[string]any{"status": "completed", "sessionId": "session-1"}
			case "_goose/unstable/schedules/running-job/kill":
				result = map[string]any{"message": "stopped"}
			}
			_ = writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": result})
		}
	}))
	defer server.Close()
	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", nil)
	defer client.Close()
	admin := controller.NewGooseAdmin(client, controller.NewSettings(persist.Store{Dir: t.TempDir()}, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	want := []request{
		{method: "_goose/unstable/schedules/list", params: map[string]any{}},
		{method: "_goose/unstable/schedules/create", params: map[string]any{"cron": "0 * * * *", "recipe": map[string]any{"title": "T", "description": "D"}, "id": "new"}},
		{method: "_goose/unstable/schedules/update", params: map[string]any{"cron": "0 2 * * *", "scheduleId": "job-1"}},
		{method: "_goose/unstable/schedules/pause", params: map[string]any{"scheduleId": "job-1"}},
		{method: "_goose/unstable/schedules/unpause", params: map[string]any{"scheduleId": "job-1"}},
		{method: "_goose/unstable/schedules/delete", params: map[string]any{"scheduleId": "job-1"}},
		{method: "_goose/unstable/schedules/run-now", params: map[string]any{"scheduleId": "job-1"}},
		{method: "_goose/unstable/schedules/running-job/inspect", params: map[string]any{"jobId": "job-1"}},
		{method: "_goose/unstable/schedules/running-job/kill", params: map[string]any{"jobId": "job-1"}},
		{method: "_goose/unstable/schedules/sessions/list", params: map[string]any{"scheduleId": "job-1", "limit": float64(25)}},
	}
	callIndex := 0
	call := func(method string, params map[string]any) any {
		raw, err := json.Marshal(params)
		if err != nil {
			t.Fatal(err)
		}
		result, err := admin.Handle(ctx, method, raw, "test")
		if err != nil {
			t.Fatalf("%s: %v", method, err)
		}
		got := <-requests
		if got.method == "" {
			t.Fatalf("%s: missing upstream request", method)
		}
		if callIndex >= len(want) || got.method != want[callIndex].method || !reflect.DeepEqual(got.params, want[callIndex].params) {
			t.Fatalf("%s upstream request = %#v, want %#v", method, got, want[callIndex])
		}
		callIndex++
		return result
	}

	if got := call("goose.scheduleList", nil).([]map[string]any)[0]; got["id"] != "job-1" || got["paused"] != true || got["lastRun"] != "2026-09-03T00:00:00Z" {
		t.Fatalf("schedule list normalization: %#v", got)
	}
	if got := call("goose.scheduleCreate", map[string]any{"id": "new", "cron": " 0 * * * * ", "recipe": map[string]any{"title": "T", "description": "D"}}).(map[string]any); got["cron"] != "0 * * * *" {
		t.Fatalf("schedule create normalization: %#v", got)
	}
	call("goose.scheduleUpdate", map[string]any{"scheduleId": "job-1", "cron": "0 2 * * *"})
	for _, method := range []string{"goose.schedulePause", "goose.scheduleResume", "goose.scheduleDelete"} {
		if got := call(method, map[string]any{"scheduleId": "job-1"}).(map[string]bool); !got["ok"] {
			t.Fatalf("%s response: %#v", method, got)
		}
	}
	if got := call("goose.scheduleRunNow", map[string]any{"scheduleId": "job-1"}).(map[string]any); got["status"] != "completed" || got["sessionId"] != "session-1" {
		t.Fatalf("run-now response: %#v", got)
	}
	if got := call("goose.scheduleInspect", map[string]any{"scheduleId": "job-1"}).(map[string]any); got["running"] != true || got["sessionId"] != "session-1" {
		t.Fatalf("inspect response: %#v", got)
	}
	if got := call("goose.scheduleKill", map[string]any{"scheduleId": "job-1"}).(map[string]any); got["message"] != "stopped" {
		t.Fatalf("kill response: %#v", got)
	}
	if got := call("goose.scheduleSessions", map[string]any{"scheduleId": "job-1", "limit": 25}).([]map[string]any)[0]; got["sessionId"] != "session-1" || got["archived"] != true {
		t.Fatalf("session normalization: %#v", got)
	}

	if callIndex != len(want) {
		t.Fatalf("checked %d upstream requests, want %d", callIndex, len(want))
	}
}

func TestGooseSchedulerDisabledCapabilityReturnsClearError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, r *http.Request) {
		connection, _ := websocket.Accept(response, r, nil)
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
			_ = json.Unmarshal(payload, &rpc)
			if rpc.Method == "initialize" {
				_ = writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": gooseInitializeResponse()})
				continue
			}
			_ = writeRPC(connection, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "error": map[string]any{"code": -32602, "message": "scheduler is disabled"}})
		}
	}))
	defer server.Close()
	client := controller.NewGooseClient("ws"+strings.TrimPrefix(server.URL, "http"), "", "test", nil)
	defer client.Close()
	admin := controller.NewGooseAdmin(client, controller.NewSettings(persist.Store{Dir: t.TempDir()}, nil))
	_, err := admin.Handle(context.Background(), "goose.scheduleList", []byte(`{}`), "test")
	if err == nil || !strings.Contains(err.Error(), "could not complete") {
		t.Fatalf("disabled scheduler error = %v", err)
	}
}
