package controller

import (
	"context"
	"fmt"
)

func (a *GooseAdmin) completions(ctx context.Context, method string, request map[string]any) (any, error) {
	if a.sessions == nil {
		return nil, fmt.Errorf("sessions are not configured")
	}
	params := map[string]any{}
	if method == "skill.list" {
		project, err := a.sessions.projects.Get(textValue(request["projectId"]))
		if err != nil {
			return nil, err
		}
		if len(project.Roots) == 0 {
			return []any{}, nil
		}
		cwd, err := a.sessions.projects.AssertRoot(project.ID, project.Roots[0])
		if err != nil {
			return nil, err
		}
		params["cwd"] = cwd
	} else {
		sessionID, err := requiredIdentifier(request["sessionId"], "Session identifier")
		if err != nil {
			return nil, err
		}
		var entry *sessionEntry
		if method == "session.getAgentMentions" {
			projectID := textValue(request["projectId"])
			cwd, err := a.sessions.RecordedCWD(projectID, sessionID)
			if err != nil {
				return nil, err
			}
			entry, err = a.sessions.EnsureAttached(ctx, sessionID, projectID, cwd)
			if err != nil {
				return nil, err
			}
		} else {
			entry, err = a.sessions.entry(sessionID)
			if err != nil {
				return nil, err
			}
		}
		defer a.sessions.releaseEntry(entry)
		if err := a.sessions.lockEntry(sessionID, entry); err != nil {
			return nil, err
		}
		defer entry.op.Unlock()
		if _, err := a.sessions.projects.AssertCWD(entry.projectID, entry.cwd); err != nil {
			return nil, err
		}
		if err := a.sessions.attachLocked(ctx, sessionID, entry); err != nil {
			return nil, err
		}
		ctx = entry.context(ctx)
		params["sessionId"] = sessionID
		if method == "session.getAgentMentions" {
			params["cwd"] = entry.cwd
			response, err := a.objectCall(ctx, "_goose/unstable/agent-mentions/list", params)
			if err != nil {
				return nil, fmt.Errorf("couldn't load agent mentions")
			}
			return projectAgentMentions(response["agents"])
		}
	}
	response, err := a.objectCall(ctx, "_goose/unstable/slash-commands/list", params)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for _, value := range arrayValue(response["availableCommands"]) {
		command := mapValue(value)
		name, err := requiredIdentifier(command["name"], "Command name")
		if err != nil {
			return nil, err
		}
		entry := map[string]any{"name": name, "source": "goose", "sourceInfo": map[string]any{"path": name, "source": "Goose", "scope": "temporary", "origin": "top-level"}}
		if description := textValue(command["description"]); description != "" {
			entry["description"] = description
		}
		result = append(result, entry)
	}
	return result, nil
}

func projectAgentMentions(value any) ([]map[string]any, error) {
	mentions, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("Goose response is missing agents")
	}
	result := make([]map[string]any, 0)
	total := 0
	for _, value := range mentions {
		raw := mapValue(value)
		entry := map[string]any{}
		size, bounded := 0, true
		for _, field := range []struct {
			key   string
			limit int
		}{{"name", 256}, {"description", 2048}, {"sourceType", 32}, {"mention", 512}} {
			text, ok := raw[field.key].(string)
			if !ok {
				return nil, fmt.Errorf("Goose agent mention is missing %s", field.key)
			}
			entry[field.key] = text
			size += len(text)
			bounded = bounded && len(text) <= field.limit
		}
		if !contains([]string{"skill", "builtinSkill", "recipe", "subrecipe", "agent", "project"}, textValue(entry["sourceType"])) {
			return nil, fmt.Errorf("Goose agent mention has an unsupported source type")
		}
		if path := raw["sourcePath"]; path != nil {
			if _, ok := path.(string); !ok {
				return nil, fmt.Errorf("Goose agent mention has an invalid source path")
			}
		}
		if bounded && total+size <= 32*1024 && len(result) < 64 {
			result = append(result, entry)
			total += size
		}
	}
	return result, nil
}
