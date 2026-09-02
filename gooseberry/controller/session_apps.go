package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/url"
	"strings"
)

const maxAppURIBytes = 64 * 1024

// AppAttachment is the authority-only subset of Goose's trusted MCP App
// attachment. Resource content and metadata are read from Goose on demand and
// are never retained in session state.
type AppAttachment struct {
	ToolName      string `json:"toolName"`
	ExtensionName string `json:"extensionName"`
	ResourceURI   string `json:"resourceUri"`
}

type appAttachmentState struct {
	attachment AppAttachment
}

func projectAppAttachment(entry *sessionEntry, toolCallID string, update map[string]any) map[string]any {
	if toolCallID == "" {
		return nil
	}
	if app, ok := parseAppAttachment(update); ok {
		if entry.appAttachments == nil {
			entry.appAttachments = make(map[string]appAttachmentState)
		}
		entry.appAttachments[toolCallID] = appAttachmentState{attachment: app}
	}
	state, ok := entry.appAttachments[toolCallID]
	if !ok {
		return nil
	}
	return appAttachmentValue(state.attachment)
}

func parseAppAttachment(update map[string]any) (AppAttachment, bool) {
	value, exists := mapValue(mapValue(update["_meta"])["goose"])["mcpApp"]
	if !exists || value == nil {
		return AppAttachment{}, false
	}
	raw, ok := value.(map[string]any)
	if !ok || raw["toolNameIsActual"] != true {
		return AppAttachment{}, false
	}
	toolName, err := appIdentifier(raw["toolName"], "App tool name")
	if err != nil {
		return AppAttachment{}, false
	}
	extensionName, err := appIdentifier(raw["extensionName"], "App extension name")
	if err != nil {
		return AppAttachment{}, false
	}
	resourceURI, ok := raw["resourceUri"].(string)
	if !ok || validateAppURI(resourceURI, true) != nil {
		return AppAttachment{}, false
	}
	return AppAttachment{ToolName: toolName, ExtensionName: extensionName, ResourceURI: resourceURI}, true
}

func appAttachmentValue(attachment AppAttachment) map[string]any {
	return map[string]any{
		"toolName":      attachment.ToolName,
		"extensionName": attachment.ExtensionName,
		"resourceUri":   attachment.ResourceURI,
	}
}

// Trusted App metadata stays out of transcript details. All unrelated tool
// metadata remains available to the ordinary tool presentation.
func toolDetailsWithoutApp(update map[string]any) map[string]any {
	meta := mapValue(update["_meta"])
	goose := mapValue(meta["goose"])
	if _, exists := goose["mcpApp"]; !exists {
		return update
	}
	details := maps.Clone(update)
	cleanMeta := maps.Clone(meta)
	cleanGoose := maps.Clone(goose)
	delete(cleanGoose, "mcpApp")
	if len(cleanGoose) == 0 {
		delete(cleanMeta, "goose")
	} else {
		cleanMeta["goose"] = cleanGoose
	}
	if len(cleanMeta) == 0 {
		delete(details, "_meta")
	} else {
		details["_meta"] = cleanMeta
	}
	return details
}

func toolDetailsForAgent(update map[string]any, trustedGoose bool) map[string]any {
	if trustedGoose {
		return toolDetailsWithoutApp(update)
	}
	meta := mapValue(update["_meta"])
	if len(meta) == 0 {
		return update
	}
	details := maps.Clone(update)
	cleanMeta := maps.Clone(meta)
	delete(cleanMeta, "goose")
	delete(cleanMeta, "toolNotification")
	if len(cleanMeta) == 0 {
		delete(details, "_meta")
	} else {
		details["_meta"] = cleanMeta
	}
	return details
}

func appIdentifier(value any, label string) (string, error) {
	text, err := requiredIdentifier(value, label)
	if err != nil || len(text) > 1024 {
		return "", fmt.Errorf("%s is invalid", label)
	}
	return text, nil
}

func validateAppURI(value string, requireUI bool) error {
	if value == "" || len(value) > maxAppURIBytes || strings.ContainsRune(value, 0) {
		return fmt.Errorf("App resource URI is invalid")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || requireUI && parsed.Scheme != "ui" {
		return fmt.Errorf("App resource URI is invalid")
	}
	return nil
}

func validateAppResourceResult(result map[string]any) error {
	contents, ok := result["contents"].([]any)
	if !ok {
		return fmt.Errorf("Goose returned an invalid App resource")
	}
	if meta, exists := result["_meta"]; exists && meta != nil {
		if _, ok := meta.(map[string]any); !ok {
			return fmt.Errorf("Goose returned an invalid App resource")
		}
	}
	for _, value := range contents {
		content, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("Goose returned an invalid App resource")
		}
		uri, ok := content["uri"].(string)
		if !ok || validateAppURI(uri, false) != nil {
			return fmt.Errorf("Goose returned an invalid App resource")
		}
		if mimeType, exists := content["mimeType"]; exists && mimeType != nil {
			if _, ok := mimeType.(string); !ok {
				return fmt.Errorf("Goose returned an invalid App resource")
			}
		}
		_, hasText := content["text"].(string)
		_, hasBlob := content["blob"].(string)
		if hasText == hasBlob {
			return fmt.Errorf("Goose returned an invalid App resource")
		}
		if meta, exists := content["_meta"]; exists && meta != nil {
			if _, ok := meta.(map[string]any); !ok {
				return fmt.Errorf("Goose returned an invalid App resource")
			}
		}
	}
	return nil
}

func (m *SessionManager) ReadAppResource(ctx context.Context, projectID, sessionID, toolCallID string, attachment AppAttachment, uri string) (any, error) {
	if err := validateAppURI(uri, false); err != nil {
		return nil, err
	}
	entry, state, err := m.appOperation(ctx, projectID, sessionID, toolCallID)
	if err != nil {
		return nil, err
	}
	defer m.releaseAppOperation(entry)
	if !sameAppAttachment(state.attachment, attachment) {
		return nil, fmt.Errorf("App attachment changed after the view opened")
	}
	return m.readAppResourceLocked(ctx, entry, state, sessionID, uri)
}

func (m *SessionManager) readAppResourceLocked(ctx context.Context, entry *sessionEntry, state appAttachmentState, sessionID, uri string) (map[string]any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	raw, err := m.client.CallGoose(entry.context(ctx), "_goose/unstable/resources/read", map[string]any{
		"sessionId":     sessionID,
		"uri":           uri,
		"extensionName": state.attachment.ExtensionName,
	})
	if err != nil {
		return nil, fmt.Errorf("Goose could not read the App resource")
	}
	var response struct {
		Result map[string]any `json:"result"`
	}
	if json.Unmarshal(raw, &response) != nil || response.Result == nil || validateAppResourceResult(response.Result) != nil {
		return nil, fmt.Errorf("Goose returned an invalid App resource")
	}
	return response.Result, nil
}

func (m *SessionManager) CallAppTool(ctx context.Context, projectID, sessionID, toolCallID string, attachment AppAttachment, name string, arguments map[string]any) (any, error) {
	name, err := appIdentifier(name, "App tool name")
	if err != nil {
		return nil, err
	}
	entry, state, err := m.appOperation(ctx, projectID, sessionID, toolCallID)
	if err != nil {
		return nil, err
	}
	defer m.releaseAppOperation(entry)
	if !sameAppAttachment(state.attachment, attachment) {
		return nil, fmt.Errorf("App attachment changed after the view opened")
	}
	if arguments == nil {
		arguments = map[string]any{}
	}
	prefix := state.attachment.ExtensionName + "__"
	if strings.Contains(name, "__") {
		if !strings.HasPrefix(name, prefix) {
			return nil, fmt.Errorf("App tool does not belong to its extension")
		}
	} else {
		name = prefix + name
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	raw, err := m.client.CallGoose(entry.context(ctx), "_goose/unstable/tools/call", map[string]any{
		"sessionId": sessionID,
		"name":      name,
		"arguments": arguments,
	})
	if err != nil {
		return nil, fmt.Errorf("Goose could not call the App tool")
	}
	var response map[string]any
	if json.Unmarshal(raw, &response) != nil {
		return nil, fmt.Errorf("Goose returned an invalid App tool result")
	}
	if _, ok := response["isError"].(bool); !ok {
		return nil, fmt.Errorf("Goose returned an invalid App tool result")
	}
	if content, exists := response["content"]; exists && content != nil {
		if _, ok := content.([]any); !ok {
			return nil, fmt.Errorf("Goose returned an invalid App tool result")
		}
	} else {
		response["content"] = []any{}
	}
	if structured, exists := response["structuredContent"]; exists && structured != nil {
		if _, ok := structured.(map[string]any); !ok {
			return nil, fmt.Errorf("Goose returned an invalid App tool result")
		}
	}
	if meta, exists := response["_meta"]; exists && meta != nil {
		if _, ok := meta.(map[string]any); !ok {
			return nil, fmt.Errorf("Goose returned an invalid App tool result")
		}
	}
	return response, nil
}

func (m *SessionManager) appOperation(ctx context.Context, projectID, sessionID, toolCallID string) (*sessionEntry, appAttachmentState, error) {
	if _, err := appIdentifier(projectID, "Project identifier"); err != nil {
		return nil, appAttachmentState{}, err
	}
	if _, err := appIdentifier(sessionID, "Session identifier"); err != nil {
		return nil, appAttachmentState{}, err
	}
	if _, err := appIdentifier(toolCallID, "Tool call identifier"); err != nil {
		return nil, appAttachmentState{}, err
	}
	cwd, err := m.RecordedCWD(projectID, sessionID)
	if err != nil {
		return nil, appAttachmentState{}, err
	}
	entry, err := m.EnsureAttached(ctx, sessionID, projectID, cwd)
	if err != nil {
		return nil, appAttachmentState{}, err
	}
	if err := m.lockEntryContext(ctx, sessionID, entry); err != nil {
		m.releaseEntry(entry)
		return nil, appAttachmentState{}, err
	}
	if err := ctx.Err(); err != nil {
		entry.op.Unlock()
		m.releaseEntry(entry)
		return nil, appAttachmentState{}, err
	}
	if err := m.attachLocked(ctx, sessionID, entry); err != nil {
		entry.op.Unlock()
		m.releaseEntry(entry)
		return nil, appAttachmentState{}, err
	}
	entry.state.Lock()
	state, found := entry.appAttachments[toolCallID]
	entry.state.Unlock()
	if !found {
		entry.op.Unlock()
		m.releaseEntry(entry)
		return nil, appAttachmentState{}, fmt.Errorf("unknown App attachment")
	}
	return entry, state, nil
}

func (m *SessionManager) releaseAppOperation(entry *sessionEntry) {
	entry.op.Unlock()
	m.releaseEntry(entry)
}

func sameAppAttachment(left, right AppAttachment) bool {
	return left.ExtensionName == right.ExtensionName && left.ResourceURI == right.ResourceURI && left.ToolName == right.ToolName
}
