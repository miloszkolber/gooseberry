package controller

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const questionTimeout = 30 * time.Minute

func (m *SessionManager) AskQuestion(sessionID string, value any) (map[string]any, error) {
	args, err := validateQuestionArgs(value)
	if err != nil {
		return nil, err
	}
	entry, err := m.entry(sessionID)
	if err != nil {
		return nil, err
	}
	defer m.releaseEntry(entry)
	var toolCallID string
	for attempt := 0; attempt < 40; attempt++ {
		entry.state.Lock()
		toolCallID = latestQuestionToolCall(entry, args)
		if toolCallID != "" {
			entry.consumedQuestions[toolCallID] = true
		}
		entry.state.Unlock()
		if toolCallID != "" {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if toolCallID == "" {
		return nil, fmt.Errorf("no matching ask_user_question tool call is active")
	}
	pending := &pendingQuestion{sessionID: sessionID, args: args, result: make(chan map[string]any, 1)}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return map[string]any{"answers": []any{}, "cancelled": true}, nil
	}
	m.questions[toolCallID] = pending
	m.mu.Unlock()
	timer := time.NewTimer(questionTimeout)
	defer timer.Stop()
	var result map[string]any
	select {
	case result = <-pending.result:
	case <-timer.C:
		result = map[string]any{"answers": []any{}, "cancelled": true}
	}
	m.mu.Lock()
	if m.questions[toolCallID] == pending {
		delete(m.questions, toolCallID)
	}
	m.mu.Unlock()
	return result, nil
}

func (m *SessionManager) ResolveQuestion(sessionID, toolCallID string, result map[string]any) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	pending := m.questions[toolCallID]
	if pending == nil || pending.sessionID != sessionID {
		return fmt.Errorf("question is no longer awaiting input")
	}
	if err := validateQuestionResult(result, pending.args); err != nil {
		return err
	}
	select {
	case pending.result <- result:
		delete(m.questions, toolCallID)
		return nil
	default:
		return fmt.Errorf("question is no longer awaiting input")
	}
}

func validateQuestionArgs(value any) (map[string]any, error) {
	args, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("question arguments must be an object")
	}
	questions := arrayValue(args["questions"])
	if len(questions) < 1 || len(questions) > 8 {
		return nil, fmt.Errorf("ask between 1 and 8 questions")
	}
	for _, rawQuestion := range questions {
		question := mapValue(rawQuestion)
		prompt, header := strings.TrimSpace(textValue(question["question"])), strings.TrimSpace(textValue(question["header"]))
		options := arrayValue(question["options"])
		if prompt == "" || utf16Length(prompt) > 2_000 || header == "" || utf16Length(header) > 200 || len(options) < 1 || len(options) > 12 {
			return nil, fmt.Errorf("question text, header, or options are invalid")
		}
		for _, rawOption := range options {
			option := mapValue(rawOption)
			if strings.TrimSpace(textValue(option["label"])) == "" {
				return nil, fmt.Errorf("question options are invalid")
			}
			if _, ok := option["description"].(string); !ok {
				return nil, fmt.Errorf("question options are invalid")
			}
		}
	}
	return args, nil
}

func latestQuestionToolCall(entry *sessionEntry, args map[string]any) string {
	wanted := stableJSON(args)
	for messageIndex := len(entry.messages) - 1; messageIndex >= 0; messageIndex-- {
		message := mapValue(entry.messages[messageIndex])
		if message["role"] != "assistant" {
			continue
		}
		content := arrayValue(message["content"])
		for blockIndex := len(content) - 1; blockIndex >= 0; blockIndex-- {
			block := mapValue(content[blockIndex])
			id := textValue(block["id"])
			if block["type"] == "toolCall" && block["name"] == "ask_user_question" && !entry.consumedQuestions[id] && stableJSON(block["arguments"]) == wanted {
				return id
			}
		}
	}
	return ""
}

func validateQuestionResult(result, args map[string]any) error {
	answers, answersOK := result["answers"].([]any)
	_, cancelledOK := result["cancelled"].(bool)
	questions := arrayValue(args["questions"])
	if !answersOK || !cancelledOK || len(answers) > len(questions) {
		return fmt.Errorf("malformed question response")
	}
	seen := make(map[int]bool)
	for _, rawAnswer := range answers {
		answer := mapValue(rawAnswer)
		indexValue, ok := numeric(answer["questionIndex"])
		index := int(indexValue)
		if !ok || int64(index) != indexValue || index < 0 || index >= len(questions) || seen[index] {
			return fmt.Errorf("malformed question response")
		}
		question := mapValue(questions[index])
		kind := textValue(answer["kind"])
		if textValue(answer["question"]) != textValue(question["question"]) || (kind != "option" && kind != "custom" && kind != "multi") {
			return fmt.Errorf("malformed question response")
		}
		if _, exists := answer["answer"]; !exists {
			return fmt.Errorf("malformed question response")
		}
		if value := answer["answer"]; value != nil {
			text, ok := value.(string)
			if !ok || utf16Length(text) > 8_000 {
				return fmt.Errorf("malformed question response")
			}
		}
		if value, exists := answer["selected"]; exists {
			selected, ok := value.([]any)
			if !ok || len(selected) > 12 {
				return fmt.Errorf("malformed question response")
			}
			for _, label := range selected {
				text, ok := label.(string)
				if !ok || utf16Length(text) > 500 {
					return fmt.Errorf("malformed question response")
				}
			}
		}
		for _, key := range []string{"notes", "preview"} {
			if value, exists := answer[key]; exists {
				text, ok := value.(string)
				if !ok || utf16Length(text) > 8_000 {
					return fmt.Errorf("malformed question response")
				}
			}
		}
		labels := make(map[string]map[string]any)
		for _, rawOption := range arrayValue(question["options"]) {
			option := mapValue(rawOption)
			labels[textValue(option["label"])] = option
		}
		if kind == "option" {
			selected := labels[textValue(answer["answer"])]
			if selected == nil || answer["preview"] != selected["preview"] {
				return fmt.Errorf("malformed question response")
			}
		} else if _, exists := answer["preview"]; exists {
			return fmt.Errorf("malformed question response")
		}
		if kind == "multi" {
			selected, ok := answer["selected"].([]any)
			if !ok || len(selected) > 12 {
				return fmt.Errorf("malformed question response")
			}
			for _, label := range selected {
				text, ok := label.(string)
				if !ok || labels[text] == nil {
					return fmt.Errorf("malformed question response")
				}
			}
		}
		seen[index] = true
	}
	return nil
}

func stableJSON(value any) string {
	// encoding/json sorts string map keys, including nested objects.
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
