package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"time"
	"unicode/utf8"

	acp "github.com/coder/acp-go-sdk"
)

func (m *SessionManager) SessionUpdate(ctx context.Context, notification acp.SessionNotification) error {
	raw := objectValue(notification)
	return m.applyUpdate(ctx, raw, false)
}

func (m *SessionManager) Extension(ctx context.Context, method string, params json.RawMessage) error {
	if method == "_goose/unstable/session/update" {
		var raw map[string]any
		if err := json.Unmarshal(params, &raw); err != nil {
			return err
		}
		return m.applyUpdate(ctx, raw, true)
	}
	if method == "_goose/unstable/providers/authentication/device-code" {
		var value map[string]any
		if json.Unmarshal(params, &value) == nil && m.deviceCode != nil {
			m.deviceCode(value)
		}
	}
	return nil
}

func (m *SessionManager) Permission(ctx context.Context, request acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	entry, err := m.entry(string(request.SessionId))
	if err != nil {
		return acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}, nil
	}
	defer m.releaseEntry(entry)
	id := randomID()
	pending := &pendingPermission{sessionID: string(request.SessionId), request: request, result: make(chan acp.RequestPermissionResponse, 1)}
	m.mu.Lock()
	entry.state.Lock()
	generation, tagged := ctx.Value(connectionGenerationKey{}).(uint64)
	stale := tagged && generation != entry.attached
	entry.state.Unlock()
	if m.closed || stale {
		m.mu.Unlock()
		return acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}, nil
	}
	m.permissions[id] = pending
	m.mu.Unlock()
	tool := objectValue(request.ToolCall)
	options := make([]map[string]any, 0, len(request.Options))
	for _, option := range request.Options {
		value := objectValue(option)
		options = append(options, map[string]any{"optionId": textValue(value["optionId"]), "name": textValue(value["name"]), "kind": textValue(value["kind"])})
	}
	m.emit("session.permissionRequest", map[string]any{"id": id, "sessionId": pending.sessionID, "toolCallId": textValue(tool["toolCallId"]), "title": textValue(tool["title"]), "options": options})
	timer := time.NewTimer(permissionTimeout)
	defer timer.Stop()
	var result acp.RequestPermissionResponse
	select {
	case result = <-pending.result:
	case <-ctx.Done():
		result = acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}
	case <-timer.C:
		result = acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}
	}
	m.mu.Lock()
	if m.permissions[id] == pending {
		delete(m.permissions, id)
	}
	m.mu.Unlock()
	m.emit("session.permissionResolved", map[string]any{"sessionId": pending.sessionID, "permissionId": id})
	return result, nil
}

func (m *SessionManager) ResolvePermission(sessionID, permissionID, optionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	pending := m.permissions[permissionID]
	if pending == nil || pending.sessionID != sessionID {
		return fmt.Errorf("unknown or expired permission request")
	}
	response := acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}
	if optionID != "" {
		found := false
		for _, option := range pending.request.Options {
			value := objectValue(option)
			if textValue(value["optionId"]) == optionID {
				response.Outcome = acp.NewRequestPermissionOutcomeSelected(acp.PermissionOptionId(optionID))
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("invalid permission option")
		}
	}
	select {
	case pending.result <- response:
		delete(m.permissions, permissionID)
		return nil
	default:
		return fmt.Errorf("unknown or expired permission request")
	}
}

func (m *SessionManager) PendingPermissions() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]map[string]any, 0, min(len(m.permissions), 100))
	for id, pending := range m.permissions {
		if len(result) == 100 {
			break
		}
		tool := objectValue(pending.request.ToolCall)
		options := make([]map[string]any, 0, len(pending.request.Options))
		for _, option := range pending.request.Options {
			value := objectValue(option)
			options = append(options, map[string]any{"optionId": textValue(value["optionId"]), "name": textValue(value["name"]), "kind": textValue(value["kind"])})
		}
		result = append(result, map[string]any{"id": id, "sessionId": pending.sessionID, "toolCallId": textValue(tool["toolCallId"]), "title": textValue(tool["title"]), "options": options})
	}
	return result
}

func (m *SessionManager) applyUpdate(ctx context.Context, notification map[string]any, gooseOnly bool) error {
	sessionID := textValue(notification["sessionId"])
	if sessionID == "" {
		return fmt.Errorf("Goose update is missing sessionId")
	}
	update := mapValue(notification["update"])
	kind := textValue(update["sessionUpdate"])
	m.mu.Lock()
	entry := m.sessions[sessionID]
	if m.closed {
		entry = nil
	}
	m.mu.Unlock()
	if entry == nil {
		return nil
	}
	entry.state.Lock()
	target := entry
	publish := true
	if entry.replay != nil {
		target = entry.replay
		publish = false
	}
	// The SDK drains already-received notifications after disconnect. They must
	// not enter a transcript being replayed over a replacement connection.
	if generation, tagged := ctx.Value(connectionGenerationKey{}).(uint64); tagged && generation != target.attached {
		entry.state.Unlock()
		return nil
	}
	events := applySessionUpdate(target, kind, update, gooseOnly)
	if publish {
		for _, event := range events {
			if event["type"] == "message_start" {
				event["message"] = cloneJSON(event["message"])
			}
		}
	}
	entry.state.Unlock()
	if publish {
		for _, event := range events {
			m.emit("agent.event", map[string]any{"sessionId": sessionID, "event": event})
		}
	}
	return nil
}

func applySessionUpdate(entry *sessionEntry, kind string, update map[string]any, gooseOnly bool) []map[string]any {
	// Notifications can change a closed chat without holding an operation ref.
	entry.inactiveBytes = 0
	if gooseOnly {
		return applyGooseOnlyUpdate(entry, kind, update)
	}
	switch kind {
	case "agent_message_chunk", "user_message_chunk":
		role := "assistant"
		if kind == "user_message_chunk" {
			role = "user"
		}
		content := mapValue(update["content"])
		if textValue(content["type"]) == "image" {
			image := map[string]any{"type": "image", "data": textValue(content["data"]), "mimeType": textValue(content["mimeType"])}
			if role == "user" && consumeEchoImage(entry, image) {
				return nil
			}
			appendMessageBlock(entry, role, image)
			entry.stats.TotalMessages = len(entry.messages)
			if role == "user" {
				return []map[string]any{{"type": "message_start", "message": entry.messages[len(entry.messages)-1]}}
			}
			entry.streaming = true
			return []map[string]any{{"type": "image", "messageId": optionalText(update["messageId"]), "image": image}}
		}
		if content["type"] != "text" && content["text"] == nil {
			return nil
		}
		text := textValue(content["text"])
		if role == "user" && consumeEchoText(entry, text) {
			return nil
		}
		appendMessageBlock(entry, role, map[string]any{"type": "text", "text": text})
		entry.streaming = true
		entry.stats.TotalMessages = len(entry.messages)
		if role == "user" {
			return []map[string]any{{"type": "message_start", "message": entry.messages[len(entry.messages)-1]}}
		}
		return []map[string]any{{"type": "text", "messageId": optionalText(update["messageId"]), "text": text}}
	case "agent_thought_chunk":
		text := textValue(mapValue(update["content"])["text"])
		appendMessageBlock(entry, "assistant", map[string]any{"type": "thinking", "thinking": text})
		entry.streaming = true
		return []map[string]any{{"type": "thinking", "messageId": optionalText(update["messageId"]), "text": text}}
	case "tool_call":
		toolName := textValue(mapValue(mapValue(mapValue(update["_meta"])["goose"])["toolCall"])["toolName"])
		if toolName == "" {
			toolName = textValue(update["title"])
		}
		if toolName == "" {
			toolName = "tool"
		}
		if strings.HasSuffix(toolName, "__ask_user_question") {
			toolName = "ask_user_question"
		}
		toolID := textValue(update["toolCallId"])
		delete(entry.pendingToolOutputs, toolID)
		input := update["rawInput"]
		if input == nil {
			input = map[string]any{}
		}
		appendMessageBlock(entry, "assistant", map[string]any{"type": "toolCall", "id": toolID, "toolName": toolName, "name": toolName, "arguments": input})
		entry.stats.TotalMessages = len(entry.messages)
		return []map[string]any{{"type": "tool-start", "toolCallId": toolID, "toolName": toolName, "tool": input}}
	case "tool_call_update":
		toolID := textValue(update["toolCallId"])
		status := textValue(update["status"])
		finished := status == "completed" || status == "error" || status == "failed"
		result := projectToolOutput(entry, toolID, update, finished)
		if finished {
			message := map[string]any{"role": "toolResult", "toolCallId": toolID, "content": result, "details": update}
			if status == "error" || status == "failed" {
				message["isError"] = true
			}
			entry.messages = append(entry.messages, message)
		}
		eventType := "tool-update"
		if finished {
			eventType = "tool-end"
		}
		return []map[string]any{{"type": eventType, "toolCallId": toolID, "status": status, "tool": result}}
	case "config_option_update":
		entry.configOptions = arrayValue(update["configOptions"])
		entry.thinkingLevel = thinkingFromOptions(entry.configOptions)
		return []map[string]any{{"type": "config", "configOptions": entry.configOptions}}
	case "session_info_update":
		if title := textValue(update["title"]); title != "" {
			entry.title = title
		}
		gooseMeta := mapValue(mapValue(update["_meta"])["goose"])
		if value, exists := gooseMeta["activeRunId"]; exists {
			entry.runID = textValue(value)
		}
		return []map[string]any{{"type": "session-info", "title": entry.title}}
	}
	return nil
}

// ACP updates replace only the supplied fields. Keep unfinished output by call
// ID so interleaved tools and status-only completion cannot erase it.
type toolOutput struct {
	Raw       any
	Content   any
	LiveText  string
	Sequence  float64
	Truncated bool
}

func projectToolOutput(entry *sessionEntry, id string, update map[string]any, finished bool) any {
	output := entry.pendingToolOutputs[id]
	if raw := update["rawOutput"]; raw != nil {
		output.Raw = raw
	} else if failure := update["error"]; failure != nil {
		output.Raw = failure
	}
	if content := update["content"]; content != nil {
		output.Content = content
	}
	// Goose shell output arrives as ordered deltas, not a final result snapshot.
	notification := mapValue(mapValue(update["_meta"])["toolNotification"])
	if notification["type"] == "live_output" {
		params := mapValue(notification["params"])
		sequence, _ := params["sequence"].(float64)
		if sequence > output.Sequence {
			output.Sequence = sequence
			output.Truncated = output.Truncated || params["truncated"] == true
			const maxLiveOutput = 256 * 1024
			for _, chunk := range arrayValue(params["chunks"]) {
				text := textValue(mapValue(chunk)["output"])
				remaining := maxLiveOutput - len(output.LiveText)
				if len(text) > remaining {
					output.Truncated = true
					for remaining > 0 && !utf8.RuneStart(text[remaining]) {
						remaining--
					}
					text = text[:remaining]
				}
				output.LiveText += text
			}
		}
	}
	if finished {
		delete(entry.pendingToolOutputs, id)
	} else {
		if entry.pendingToolOutputs == nil {
			entry.pendingToolOutputs = make(map[string]toolOutput)
		}
		entry.pendingToolOutputs[id] = output
	}
	if output.Raw != nil && len(arrayValue(output.Content)) > 0 {
		return map[string]any{"structuredContent": output.Raw, "content": output.Content}
	}
	if output.Raw != nil {
		return output.Raw
	}
	if output.Content != nil {
		return output.Content
	}
	if output.Truncated {
		return output.LiveText + "\n[Live output truncated]"
	}
	if output.LiveText != "" {
		return output.LiveText
	}
	return nil
}

func applyGooseOnlyUpdate(entry *sessionEntry, kind string, update map[string]any) []map[string]any {
	switch kind {
	case "message_usage":
		usage := mapValue(update["usage"])
		input := integerValue(usage["inputTokens"])
		output := integerValue(usage["outputTokens"])
		cacheRead := integerValue(usage["cacheReadTokens"])
		cacheWrite := integerValue(usage["cacheWriteTokens"])
		total, totalReported := numeric(usage["totalTokens"])
		if !totalReported {
			total = input + output + cacheRead + cacheWrite
		}
		entry.stats.Tokens.Input += input
		entry.stats.Tokens.Output += output
		entry.stats.Tokens.CacheRead += cacheRead
		entry.stats.Tokens.CacheWrite += cacheWrite
		entry.stats.Tokens.Total += total
		entry.stats.Cost += floatValue(usage["cost"])
		reported := maps.Clone(entry.stats.Reported)
		if reported == nil {
			reported = make(map[string]bool)
		}
		for field, key := range map[string]string{"inputTokens": "input", "outputTokens": "output", "cacheReadTokens": "cacheRead", "cacheWriteTokens": "cacheWrite", "cost": "cost"} {
			if _, ok := usage[field].(float64); ok {
				reported[key] = true
			}
		}
		if totalReported || total != 0 {
			reported["total"] = true
		}
		entry.stats.Reported = reported
		return []map[string]any{{"type": "usage", "usage": map[string]any{"input": entry.stats.Tokens.Input, "output": entry.stats.Tokens.Output, "cacheRead": entry.stats.Tokens.CacheRead, "cacheWrite": entry.stats.Tokens.CacheWrite, "total": entry.stats.Tokens.Total, "cost": entry.stats.Cost}, "reported": entry.stats.Reported}}
	case "usage_update":
		input := integerValue(update["accumulatedInputTokens"])
		output := integerValue(update["accumulatedOutputTokens"])
		entry.stats.Tokens.Input = input
		entry.stats.Tokens.Output = output
		entry.stats.Tokens.Total = input + output + entry.stats.Tokens.CacheRead + entry.stats.Tokens.CacheWrite
		reported := maps.Clone(entry.stats.Reported)
		if reported == nil {
			reported = make(map[string]bool)
		}
		reported["input"], reported["output"], reported["total"] = true, true, true
		if cost, ok := update["accumulatedCost"].(float64); ok {
			entry.stats.Cost = cost
			reported["cost"] = true
		}
		entry.stats.Reported = reported
		limit := integerValue(update["contextLimit"])
		used := integerValue(update["used"])
		var percent any
		if limit > 0 {
			percent = float64(used) / float64(limit) * 100
		}
		entry.stats.ContextUsage = map[string]any{"tokens": used, "contextWindow": limit, "percent": percent}
		return []map[string]any{{"type": "context", "contextUsage": entry.stats.ContextUsage}}
	case "status_message":
		status := mapValue(update["status"])
		kind := textValue(status["type"])
		message := textValue(status["message"])
		if strings.Contains(strings.ToLower(kind), "error") || strings.Contains(strings.ToLower(kind), "fail") {
			entry.streaming = false
			entry.settlement = &SessionSettlement{StopReason: "error", ErrorMessage: message}
			return []map[string]any{{"type": "error", "error": message}}
		}
		if strings.Contains(strings.ToLower(kind), "complete") || strings.Contains(strings.ToLower(kind), "idle") || strings.Contains(strings.ToLower(kind), "done") || strings.Contains(strings.ToLower(kind), "cancel") {
			entry.streaming = false
			entry.settlement = &SessionSettlement{StopReason: kind}
			return []map[string]any{{"type": "complete", "status": kind}}
		}
	}
	return nil
}

func appendMessageBlock(entry *sessionEntry, role string, block map[string]any) {
	if len(entry.messages) == 0 || textValue(mapValue(entry.messages[len(entry.messages)-1])["role"]) != role {
		entry.messages = append(entry.messages, map[string]any{"role": role, "content": []any{block}})
		return
	}
	message := mapValue(entry.messages[len(entry.messages)-1])
	content, ok := message["content"].([]any)
	if !ok {
		if text, textOK := message["content"].(string); textOK {
			content = []any{map[string]any{"type": "text", "text": text}}
		}
	}
	if len(content) > 0 {
		last := mapValue(content[len(content)-1])
		if last["type"] == block["type"] && (block["type"] == "text" || block["type"] == "thinking") {
			key := "text"
			if block["type"] == "thinking" {
				key = "thinking"
			}
			last[key] = textValue(last[key]) + textValue(block[key])
			content[len(content)-1] = last
			message["content"] = content
			entry.messages[len(entry.messages)-1] = message
			return
		}
	}
	message["content"] = append(content, block)
	entry.messages[len(entry.messages)-1] = message
}

// Detach mutable transcript objects before publishing them outside the state lock.
// Strings (including images) remain shared rather than being re-encoded and copied.
func cloneJSON(value any) any {
	switch value := value.(type) {
	case map[string]any:
		clone := make(map[string]any, len(value))
		for key, item := range value {
			clone[key] = cloneJSON(item)
		}
		return clone
	case []any:
		clone := make([]any, len(value))
		for index, item := range value {
			clone[index] = cloneJSON(item)
		}
		return clone
	default:
		return value
	}
}

func consumeEchoText(entry *sessionEntry, text string) bool {
	echo := entry.pendingEcho
	if echo == nil || echo.offset > len(echo.text) || !strings.HasPrefix(echo.text[echo.offset:], text) {
		entry.pendingEcho = nil
		return false
	}
	echo.offset += len(text)
	if echoComplete(echo) {
		entry.pendingEcho = nil
	}
	return true
}

func consumeEchoImage(entry *sessionEntry, image map[string]any) bool {
	echo := entry.pendingEcho
	if echo == nil {
		return false
	}
	for index, expected := range echo.images {
		if !echo.matched[index] && expected["data"] == image["data"] && expected["mimeType"] == image["mimeType"] {
			echo.matched[index] = true
			if echoComplete(echo) {
				entry.pendingEcho = nil
			}
			return true
		}
	}
	entry.pendingEcho = nil
	return false
}

func echoComplete(echo *userEcho) bool {
	if echo.offset < len(echo.text) {
		return false
	}
	for _, matched := range echo.matched {
		if !matched {
			return false
		}
	}
	return true
}

func (m *SessionManager) emit(channel string, data any) {
	if m.publish != nil {
		m.publish(channel, stripNilFields(data))
	}
}

func objectValue(value any) map[string]any {
	encoded, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(encoded, &result)
	if result == nil {
		return map[string]any{}
	}
	return result
}

func mapValue(value any) map[string]any {
	result, _ := value.(map[string]any)
	if result == nil {
		return map[string]any{}
	}
	return result
}

func arrayValue(value any) []any {
	result, _ := value.([]any)
	if result == nil {
		return []any{}
	}
	return result
}

func textValue(value any) string { text, _ := value.(string); return text }
func optionalText(value any) any {
	if text := textValue(value); text != "" {
		return text
	}
	return nil
}
func integerValue(value any) int64 { number, _ := numeric(value); return number }
func floatValue(value any) float64 { number, _ := value.(float64); return number }

func stripNilFields(value any) any {
	if object, ok := value.(map[string]any); ok {
		for key, entry := range object {
			if entry == nil {
				delete(object, key)
			}
		}
	}
	return value
}
