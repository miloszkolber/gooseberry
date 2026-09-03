package controller

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

type gooseExtension struct {
	raw     map[string]any
	summary map[string]any
}

// Goose 1.49 moved its bundled extension catalog out of ACP and into clients.
// Goose remains authoritative for configured state.
//
//go:embed bundled-extensions.json
var bundledGooseExtensionsJSON []byte

var bundledGooseExtensions = mustBundledGooseExtensions()

func (a *GooseAdmin) Handle(ctx context.Context, method string, raw json.RawMessage, clientKey string) (any, error) {
	var request map[string]any
	if err := decodeParams(raw, &request); err != nil {
		return nil, fmt.Errorf("malformed Goose request")
	}
	switch method {
	case "provider.loginStart":
		provider, err := requiredIdentifier(request["providerId"], "Provider identifier")
		if err != nil {
			return nil, err
		}
		kind := "oauth"
		if value, exists := request["type"]; exists {
			kind = textValue(value)
		}
		return a.logins.Start(ctx, clientKey, provider, kind)
	case "provider.loginReply":
		value, ok := request["value"].(string)
		if !ok {
			return nil, fmt.Errorf("provider reply must be text")
		}
		return ack(a.logins.Reply(clientKey, textValue(request["loginId"]), value))
	case "provider.loginCancel":
		return ack(a.logins.Cancel(clientKey, textValue(request["loginId"])))
	case "goose.extensionList":
		return a.extensionCatalog(ctx)
	case "goose.extensionAdd", "goose.extensionSetEnabled", "goose.extensionRemove":
		if !a.extensionMu.TryLock() {
			return nil, fmt.Errorf("wait for the Goose extension update to finish")
		}
		defer a.extensionMu.Unlock()
		configured, _, err := a.extensions(ctx, "_goose/unstable/config/extensions/list", nil, true)
		if err != nil {
			return nil, err
		}
		if method == "goose.extensionAdd" {
			name, err := requiredIdentifier(request["name"], "Extension name")
			if err != nil {
				return nil, err
			}
			enabled, ok := request["enabled"].(bool)
			if !ok {
				return nil, fmt.Errorf("extension enabled must be true or false")
			}
			if findExtension(configured, "name", name) != nil {
				return nil, fmt.Errorf("extension is already configured: %s", name)
			}
			extension := findExtension(bundledGooseExtensions, "name", name)
			if extension == nil {
				return nil, fmt.Errorf("unknown available extension: %s", name)
			}
			err = a.call(ctx, "_goose/unstable/config/extensions/add", map[string]any{"extension": extension.raw, "enabled": enabled}, nil)
			if err != nil {
				return nil, err
			}
		} else {
			key, err := requiredIdentifier(request["configKey"], "Extension config key")
			if err != nil {
				return nil, err
			}
			if findExtension(configured, "configKey", key) == nil {
				return nil, fmt.Errorf("unknown configured extension key: %s", key)
			}
			params := map[string]any{"configKey": key}
			action := "remove"
			if method == "goose.extensionSetEnabled" {
				enabled, ok := request["enabled"].(bool)
				if !ok {
					return nil, fmt.Errorf("extension enabled must be true or false")
				}
				params["enabled"], action = enabled, "set-enabled"
			}
			if err := a.call(ctx, "_goose/unstable/config/extensions/"+action, params, nil); err != nil {
				return nil, err
			}
		}
		return a.extensionCatalog(ctx)
	case "session.extensionList", "session.extensionAdd", "session.extensionRemove", "session.toolList", "session.toolPermissionSet":
		return a.sessionAdministration(ctx, method, request)
	case "goose.agentList", "goose.agentCreate", "goose.agentUpdate", "goose.agentDelete":
		return a.handleAgents(ctx, method, request)
	case "skill.list", "session.getCommands", "session.getAgentMentions":
		return a.completions(ctx, method, request)
	default:
		return a.handleAutomation(ctx, method, request)
	}
}

func (a *GooseAdmin) extensionCatalog(ctx context.Context) (map[string]any, error) {
	configured, warnings, err := a.extensions(ctx, "_goose/unstable/config/extensions/list", nil, true)
	if err != nil {
		return nil, err
	}
	return map[string]any{"configured": extensionSummaries(configured), "available": extensionSummaries(bundledGooseExtensions), "warningCount": warnings}, nil
}

func (a *GooseAdmin) extensions(ctx context.Context, method string, params map[string]any, configured bool) ([]gooseExtension, int, error) {
	if params == nil {
		params = map[string]any{}
	}
	var response struct {
		Extensions []map[string]any `json:"extensions"`
		Warnings   []any            `json:"warnings"`
	}
	if err := a.call(ctx, method, params, &response); err != nil {
		return nil, 0, err
	}
	result := make([]gooseExtension, 0, len(response.Extensions))
	for _, value := range response.Extensions {
		raw := value
		if configured {
			raw = mapValue(value["extension"])
		}
		extension, err := summarizeExtension(raw)
		if err != nil {
			return nil, 0, err
		}
		if configured {
			enabled, ok := value["enabled"].(bool)
			if !ok {
				return nil, 0, fmt.Errorf("Goose configured extension is missing enabled")
			}
			extension.summary["enabled"] = enabled
			if key, exists := value["configKey"]; exists && key != nil {
				if _, err := requiredIdentifier(key, "Extension config key"); err != nil {
					return nil, 0, err
				}
				extension.summary["configKey"] = key
			}
		}
		result = append(result, extension)
	}
	warnings := 0
	for _, warning := range response.Warnings {
		if _, ok := warning.(string); ok {
			warnings++
		}
	}
	return result, warnings, nil
}

func (a *GooseAdmin) sessionAdministration(ctx context.Context, method string, request map[string]any) (any, error) {
	projectID, err := requiredIdentifier(request["projectId"], "Project identifier")
	if err != nil {
		return nil, err
	}
	sessionID, err := requiredIdentifier(request["sessionId"], "Session identifier")
	if err != nil {
		return nil, err
	}
	cwd, err := a.sessions.RecordedCWD(projectID, sessionID)
	if err != nil {
		return nil, err
	}
	entry, err := a.sessions.EnsureAttached(ctx, sessionID, projectID, cwd)
	if err != nil {
		return nil, err
	}
	defer a.sessions.releaseEntry(entry)
	mutation := method != "session.extensionList" && method != "session.toolList"
	if mutation {
		if !entry.op.TryLock() {
			return nil, fmt.Errorf("wait for the chat to finish loading or updating")
		}
	} else {
		if err := a.sessions.lockEntry(sessionID, entry); err != nil {
			return nil, err
		}
	}
	defer entry.op.Unlock()
	if err := a.sessions.attachLocked(ctx, sessionID, entry); err != nil {
		return nil, err
	}
	ctx = entry.context(ctx)
	entry.state.Lock()
	running := entry.streaming || entry.promptActive || entry.runID != ""
	entry.state.Unlock()
	if mutation && running {
		return nil, fmt.Errorf("stop the running chat before changing extensions or tool permissions")
	}
	params := map[string]any{"sessionId": sessionID}
	if method == "session.toolList" || method == "session.toolPermissionSet" {
		if method == "session.toolPermissionSet" {
			a.toolMu.Lock()
			defer a.toolMu.Unlock()
			name, err := requiredIdentifier(request["toolName"], "Tool name")
			if err != nil {
				return nil, err
			}
			permission := textValue(request["permission"])
			if !validToolPermission(permission) {
				return nil, fmt.Errorf("unknown tool permission")
			}
			tools, err := a.sessionTools(ctx, sessionID)
			if err != nil {
				return nil, err
			}
			found := false
			for _, tool := range tools {
				if tool["name"] == name {
					found = true
				}
			}
			if !found {
				return nil, fmt.Errorf("unknown tool for this chat: %s", name)
			}
			if err := a.call(ctx, "_goose/unstable/tools/permissions/set", map[string]any{"toolPermissions": []any{map[string]any{"toolName": name, "permission": permission}}}, nil); err != nil {
				return nil, err
			}
		}
		return a.sessionTools(ctx, sessionID)
	}
	if mutation {
		if method == "session.extensionAdd" {
			name, err := requiredIdentifier(request["name"], "Extension name")
			if err != nil {
				return nil, err
			}
			configured, _, err := a.extensions(ctx, "_goose/unstable/config/extensions/list", nil, true)
			if err != nil {
				return nil, err
			}
			extension := findExtension(append(configured, bundledGooseExtensions...), "name", name)
			if extension == nil {
				return nil, fmt.Errorf("unknown extension: %s", name)
			}
			if err := a.call(ctx, "_goose/unstable/session/extensions/add", map[string]any{"sessionId": sessionID, "extension": extension.raw}, nil); err != nil {
				return nil, err
			}
		} else {
			key, err := requiredIdentifier(request["extensionKey"], "Session extension key")
			if err != nil {
				return nil, err
			}
			active, err := a.sessionExtensions(ctx, params)
			if err != nil {
				return nil, err
			}
			if findExtension(active, "extensionKey", key) == nil {
				return nil, fmt.Errorf("extension is not active for this chat")
			}
			if err := a.call(ctx, "_goose/unstable/session/extensions/remove", map[string]any{"sessionId": sessionID, "extensionKey": key}, nil); err != nil {
				return nil, err
			}
		}
	}
	extensions, err := a.sessionExtensions(ctx, params)
	return extensionSummaries(extensions), err
}

func (a *GooseAdmin) sessionExtensions(ctx context.Context, params map[string]any) ([]gooseExtension, error) {
	var response struct {
		Extensions []struct {
			Extension    map[string]any `json:"extension"`
			ExtensionKey string         `json:"extensionKey"`
		} `json:"extensions"`
	}
	if err := a.call(ctx, "_goose/unstable/session/extensions/list", params, &response); err != nil {
		return nil, err
	}
	result := make([]gooseExtension, 0, len(response.Extensions))
	keys := make(map[string]bool, len(response.Extensions))
	for _, entry := range response.Extensions {
		key, err := requiredIdentifier(entry.ExtensionKey, "Session extension key")
		if err != nil {
			return nil, err
		}
		if keys[key] {
			return nil, fmt.Errorf("Goose session extension key is duplicated: %s", key)
		}
		keys[key] = true
		extension, err := summarizeExtension(entry.Extension)
		if err != nil {
			return nil, err
		}
		extension.summary["extensionKey"] = key
		result = append(result, extension)
	}
	return result, nil
}

func (a *GooseAdmin) sessionTools(ctx context.Context, sessionID string) ([]map[string]any, error) {
	var response struct {
		Tools []map[string]any `json:"tools"`
	}
	if err := a.call(ctx, "_goose/unstable/tools/list", map[string]any{"sessionId": sessionID}, &response); err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(response.Tools))
	for _, tool := range response.Tools {
		name, err := requiredIdentifier(tool["name"], "Tool name")
		if err != nil {
			return nil, err
		}
		item := map[string]any{"name": name, "description": textValue(tool["description"]), "parameters": stringValues(tool["parameters"])}
		if permission := tool["permission"]; permission != nil {
			if !validToolPermission(textValue(permission)) {
				return nil, fmt.Errorf("unknown Goose tool permission")
			}
			item["permission"] = permission
		}
		result = append(result, item)
	}
	return result, nil
}

func validToolPermission(value string) bool {
	return value == "always_allow" || value == "ask_before" || value == "never_allow"
}

func requiredIdentifier(value any, label string) (string, error) {
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" || containsNUL(text) {
		return "", fmt.Errorf("%s is invalid", label)
	}
	return text, nil
}

func copyFields(target, source map[string]any, keys ...string) {
	for _, key := range keys {
		if value, exists := source[key]; exists && value != nil {
			target[key] = value
		}
	}
}

func stringValues(value any) []string {
	result := []string{}
	for _, item := range arrayValue(value) {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

func extensionSummaries(values []gooseExtension) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		result = append(result, value.summary)
	}
	return result
}

func findExtension(values []gooseExtension, key, value string) *gooseExtension {
	for index := range values {
		if values[index].summary[key] == value {
			return &values[index]
		}
	}
	return nil
}

func mustBundledGooseExtensions() []gooseExtension {
	var definitions []map[string]any
	if err := json.Unmarshal(bundledGooseExtensionsJSON, &definitions); err != nil {
		panic(err)
	}
	result := make([]gooseExtension, 0, len(definitions))
	for _, definition := range definitions {
		raw := map[string]any{
			"type": definition["type"], "name": definition["name"],
			"display_name": definition["display_name"], "description": definition["description"],
			"timeout": definition["timeout"], "bundled": definition["bundled"],
		}
		for key, value := range raw {
			if value == nil {
				delete(raw, key)
			}
		}
		extension, err := summarizeExtension(raw)
		if err != nil {
			panic(err)
		}
		result = append(result, extension)
	}
	return result
}

func summarizeExtension(raw map[string]any) (gooseExtension, error) {
	kind := textValue(raw["type"])
	if kind != "builtin" && kind != "platform" && kind != "mcp" {
		return gooseExtension{}, fmt.Errorf("Goose extension has an unsupported type")
	}
	nameValue := raw["name"]
	if kind == "mcp" {
		nameValue = mapValue(raw["server"])["name"]
	}
	name, err := requiredIdentifier(nameValue, "Extension name")
	if err != nil {
		return gooseExtension{}, err
	}
	summary := map[string]any{"name": name, "type": kind}
	copyFields(summary, raw, "description", "bundled")
	if display, ok := firstString(raw["displayName"], raw["display_name"]); ok {
		summary["displayName"] = display
	}
	tools := stringValues(raw["availableTools"])
	if len(tools) == 0 {
		tools = stringValues(raw["available_tools"])
	}
	if len(tools) > 0 {
		summary["availableTools"] = tools
	}
	return gooseExtension{raw: raw, summary: summary}, nil
}
