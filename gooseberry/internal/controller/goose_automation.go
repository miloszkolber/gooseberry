package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (a *GooseAdmin) handleAutomation(ctx context.Context, method string, request map[string]any) (any, error) {
	switch method {
	case "goose.recipeList":
		response, err := a.objectCall(ctx, "_goose/unstable/recipes/list", map[string]any{})
		if err != nil {
			return nil, err
		}
		result := []map[string]any{}
		for _, candidate := range arrayValue(response["recipes"]) {
			entry := mapValue(candidate)
			item := map[string]any{"recipe": normalizeRecipe(entry["recipe"]), "raw": entry}
			for target, source := range map[string]string{"id": "id", "filePath": "file_path", "lastModified": "last_modified"} {
				value, err := requiredIdentifier(entry[source], source)
				if err != nil {
					return nil, err
				}
				item[target] = value
			}
			if value, ok := entry["schedule_cron"].(string); ok {
				item["scheduleCron"] = value
			}
			if value, ok := entry["slash_command"].(string); ok {
				item["slashCommand"] = value
			}
			result = append(result, item)
		}
		return result, nil
	case "goose.recipeSave":
		recipe, err := automationRecipe(request["recipe"])
		if err != nil {
			return nil, err
		}
		params := map[string]any{"recipe": recipe}
		if id, exists := request["id"]; exists {
			params["id"], err = automationText(id, "Recipe id", 256, false)
			if err != nil {
				return nil, err
			}
		}
		scan, err := a.objectCall(ctx, "_goose/unstable/recipes/scan", map[string]any{"recipe": recipe})
		if err != nil {
			return nil, err
		}
		if scan["has_security_warnings"] == true {
			return nil, fmt.Errorf("Goose recipe scan found security warnings. Refusing to save it")
		}
		saved, err := a.objectCall(ctx, "_goose/unstable/recipes/save", params)
		if err != nil {
			return nil, err
		}
		a.publishCommandCatalogChanged()
		result := map[string]any{}
		for target, source := range map[string]string{"id": "id", "fileName": "file_name", "filePath": "file_path"} {
			value, err := requiredIdentifier(saved[source], source)
			if err != nil {
				return nil, err
			}
			result[target] = value
		}
		return result, nil
	case "goose.recipeDelete":
		id, err := automationText(request["id"], "Recipe id", 256, false)
		if err != nil {
			return nil, err
		}
		if err := a.call(ctx, "_goose/unstable/recipes/delete", map[string]any{"id": id}, nil); err != nil {
			return nil, err
		}
		a.publishCommandCatalogChanged()
		return map[string]any{"ok": true}, nil
	case "goose.recipeParse":
		content, ok := request["content"].(string)
		if !ok || len(content) > 1024*1024 {
			return nil, fmt.Errorf("recipe source is invalid or too large")
		}
		response, err := a.objectCall(ctx, "_goose/unstable/recipes/parse", map[string]any{"content": content})
		if err != nil {
			return nil, err
		}
		return normalizeRecipe(response["recipe"]), nil
	case "goose.scheduleList":
		response, err := a.objectCall(ctx, "_goose/unstable/schedules/list", map[string]any{})
		if err != nil {
			return nil, err
		}
		result := []map[string]any{}
		for _, item := range arrayValue(response["jobs"]) {
			job, err := normalizeSchedule(item)
			if err != nil {
				return nil, err
			}
			result = append(result, job)
		}
		return result, nil
	case "goose.scheduleCreate", "goose.scheduleUpdate":
		cron, err := automationText(request["cron"], "Schedule", 512, true)
		if err != nil {
			return nil, err
		}
		params := map[string]any{"cron": cron}
		action, key := "update", "scheduleId"
		if method == "goose.scheduleCreate" {
			action, key = "create", "id"
			recipe, err := automationRecipe(request["recipe"])
			if err != nil {
				return nil, err
			}
			params["recipe"] = recipe
		}
		params[key], err = automationText(request[key], "Schedule id", 256, false)
		if err != nil {
			return nil, err
		}
		response, err := a.objectCall(ctx, "_goose/unstable/schedules/"+action, params)
		if err != nil {
			return nil, err
		}
		return normalizeSchedule(response["job"])
	case "goose.schedulePause", "goose.scheduleResume", "goose.scheduleDelete", "goose.scheduleRunNow", "goose.scheduleSessions", "goose.scheduleInspect", "goose.scheduleKill":
		id, err := automationText(request["scheduleId"], "Schedule id", 256, false)
		if err != nil {
			return nil, err
		}
		actions := map[string]string{"goose.schedulePause": "pause", "goose.scheduleResume": "unpause", "goose.scheduleDelete": "delete", "goose.scheduleRunNow": "run-now", "goose.scheduleSessions": "sessions/list", "goose.scheduleInspect": "running-job/inspect", "goose.scheduleKill": "running-job/kill"}
		params := map[string]any{"scheduleId": id}
		if method == "goose.scheduleInspect" || method == "goose.scheduleKill" {
			params = map[string]any{"jobId": id}
		}
		if method == "goose.scheduleSessions" {
			limit := int64(10)
			if raw, exists := request["limit"]; exists {
				value, ok := numeric(raw)
				if !ok || value < 1 || value > 100 {
					return nil, fmt.Errorf("schedule session limit must be between 1 and 100")
				}
				limit = value
			}
			params["limit"] = limit
		}
		response, err := a.objectCall(ctx, "_goose/unstable/schedules/"+actions[method], params)
		if err != nil {
			return nil, err
		}
		switch method {
		case "goose.schedulePause", "goose.scheduleResume", "goose.scheduleDelete":
			return ack(nil)
		case "goose.scheduleSessions":
			result := []map[string]any{}
			for _, value := range arrayValue(response["sessions"]) {
				session, err := normalizeGooseSession(value)
				if err != nil {
					return nil, err
				}
				result = append(result, session)
			}
			return result, nil
		case "goose.scheduleInspect":
			result := map[string]any{"running": response["running"] == true}
			copyFields(result, response, "sessionId", "jobStartTime", "runningDurationSeconds")
			return result, nil
		default:
			return response, nil
		}
	default:
		return nil, fmt.Errorf("unknown method: %s", method)
	}
}

func (a *GooseAdmin) publishCommandCatalogChanged() {
	if a.publish != nil {
		a.publish("goose.commandCatalogChanged", map[string]any{})
	}
}

func (a *GooseAdmin) objectCall(ctx context.Context, method string, params map[string]any) (map[string]any, error) {
	var response map[string]any
	err := a.call(ctx, method, params, &response)
	return response, err
}

func automationText(value any, label string, limit int, singleLine bool) (string, error) {
	text, err := requiredIdentifier(value, label)
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if utf16Length(text) > limit || singleLine && strings.ContainsAny(text, "\r\n") {
		return "", fmt.Errorf("%s is invalid", label)
	}
	return text, nil
}

func automationRecipe(value any) (map[string]any, error) {
	recipe, ok := value.(map[string]any)
	if !ok || recipe == nil {
		return nil, fmt.Errorf("recipe must be an object")
	}
	if _, ok := recipe["title"].(string); !ok {
		return nil, fmt.Errorf("recipe title must be text")
	}
	if _, ok := recipe["description"].(string); !ok {
		return nil, fmt.Errorf("recipe description must be text")
	}
	encoded, err := json.Marshal(recipe)
	if err != nil || len(encoded) > 1024*1024 {
		return nil, fmt.Errorf("recipe is invalid or too large")
	}
	return recipe, nil
}

func normalizeRecipe(value any) map[string]any {
	raw := mapValue(value)
	result := make(map[string]any, len(raw)+2)
	for key, item := range raw {
		result[key] = item
	}
	result["title"], result["description"] = textValue(raw["title"]), textValue(raw["description"])
	return result
}

func normalizeSchedule(value any) (map[string]any, error) {
	raw := mapValue(value)
	result := map[string]any{"currentlyRunning": raw["currentlyRunning"] == true, "paused": raw["paused"] == true, "raw": raw}
	for _, key := range []string{"id", "source", "cron"} {
		text, err := requiredIdentifier(raw[key], key)
		if err != nil {
			return nil, err
		}
		result[key] = text
	}
	copyFields(result, raw, "lastRun", "currentSessionId", "jobStartTime")
	return result, nil
}

func normalizeGooseSession(value any) (map[string]any, error) {
	raw := mapValue(value)
	id, err := requiredIdentifier(raw["sessionId"], "Session id")
	if err != nil {
		return nil, err
	}
	meta := mapValue(raw["_meta"])
	result := map[string]any{"sessionId": id, "raw": raw, "archived": false}
	copyFields(result, raw, "cwd", "title", "updatedAt")
	for _, key := range []string{"createdAt", "projectId", "messageCount", "archivedAt"} {
		if value := raw[key]; value != nil {
			result[key] = value
		} else if value := meta[key]; value != nil {
			result[key] = value
		}
	}
	if archived, ok := raw["archived"].(bool); ok {
		result["archived"] = archived
	} else {
		_, result["archived"] = result["archivedAt"]
	}
	return result, nil
}
