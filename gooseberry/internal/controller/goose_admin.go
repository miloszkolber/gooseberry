package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

type GooseAdmin struct {
	client           *GooseClient
	settings         *Settings
	publish          func(string, any)
	canonicalSlots   chan struct{}
	canonicalMu      sync.Mutex
	canonicalFlights map[canonicalKey]*canonicalFlight
	sessions         *SessionManager
	extensionMu      sync.Mutex
	toolMu           sync.Mutex
	agentMu          sync.Mutex
	logins           *ProviderLogins
}

func NewGooseAdmin(client *GooseClient, settings *Settings) *GooseAdmin {
	admin := &GooseAdmin{client: client, settings: settings, canonicalSlots: make(chan struct{}, 4), canonicalFlights: make(map[canonicalKey]*canonicalFlight)}
	admin.logins = NewProviderLogins(admin, nil)
	return admin
}

type gooseProvider struct {
	ProviderID       string                   `json:"providerId"`
	ProviderName     string                   `json:"providerName"`
	Name             string                   `json:"name"`
	Configured       *bool                    `json:"configured"`
	Available        *bool                    `json:"available"`
	VisibleInSetup   *bool                    `json:"visibleInSetup"`
	ACP              bool                     `json:"acp"`
	LastRefreshError string                   `json:"lastRefreshError"`
	Refreshing       bool                     `json:"refreshing"`
	ConfigKeys       []gooseProviderConfigKey `json:"configKeys"`
	Models           []gooseModel             `json:"models"`
}

type gooseProviderConfigKey struct {
	Name      string `json:"name"`
	Default   string `json:"default"`
	Secret    bool   `json:"secret"`
	Required  bool   `json:"required"`
	OAuthFlow bool   `json:"oauthFlow"`
	Primary   bool   `json:"primary"`
}

type gooseModel struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	ContextLimit    *int     `json:"contextLimit"`
	MaxOutputTokens *int     `json:"maxOutputTokens"`
	Reasoning       *bool    `json:"reasoning"`
	Modalities      []string `json:"modalities"`
}

func (a *GooseAdmin) providers(ctx context.Context, ids []string) ([]gooseProvider, error) {
	if ids == nil {
		ids = []string{}
	}
	var response struct {
		Entries []gooseProvider `json:"entries"`
	}
	if err := a.call(ctx, "_goose/unstable/providers/list", map[string]any{"providerIds": ids}, &response); err != nil {
		return nil, err
	}
	for _, provider := range response.Entries {
		if provider.ProviderID == "" {
			return nil, fmt.Errorf("Goose provider response is missing providerId")
		}
	}
	return response.Entries, nil
}

func (a *GooseAdmin) Models(ctx context.Context) ([]WireModel, error) {
	models, _, err := a.models(ctx)
	return models, err
}

func (a *GooseAdmin) models(ctx context.Context) ([]WireModel, bool, error) {
	providers, err := a.providers(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	config, err := a.settings.Get()
	if err != nil {
		return nil, false, err
	}
	hidden := make(map[string]bool, len(config.HiddenModels))
	for _, model := range config.HiddenModels {
		hidden[model.Provider+"\x00"+model.ID] = true
	}
	result := make([]WireModel, 0)
	for _, provider := range providers {
		available := provider.Configured != nil && *provider.Configured && providerRuntimeAvailable(provider)
		for _, model := range provider.Models {
			if model.ID == "" {
				continue
			}
			name := model.Name
			if name == "" {
				name = model.ID
			}
			input := []string(nil)
			if len(model.Modalities) > 0 {
				input = []string{"text"}
				if contains(model.Modalities, "image") {
					input = append(input, "image")
				}
			}
			result = append(result, WireModel{ID: model.ID, Name: name, Provider: provider.ProviderID, ContextWindow: model.ContextLimit, MaxTokens: model.MaxOutputTokens, Reasoning: model.Reasoning, Input: input, Available: available, Hidden: hidden[provider.ProviderID+"\x00"+model.ID]})
		}
	}
	metadataComplete := a.enrichModels(ctx, result)
	sort.Slice(result, func(i, j int) bool {
		if result[i].Provider != result[j].Provider {
			return result[i].Provider < result[j].Provider
		}
		return result[i].Name < result[j].Name
	})
	return result, metadataComplete, nil
}

func (a *GooseAdmin) enrichModels(parent context.Context, models []WireModel) bool {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	jobs := make(chan int)
	var workers sync.WaitGroup
	complete := true
	var completeMu sync.Mutex
	for worker := 0; worker < min(4, len(models)); worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				model := &models[index]
				canonical, completed := a.canonicalModel(ctx, model.Provider, model.ID)
				if !completed {
					completeMu.Lock()
					complete = false
					completeMu.Unlock()
				}
				if canonical == nil || canonical.Provider != model.Provider || canonical.Model != model.ID || canonical.ContextLimit == nil || *canonical.ContextLimit < 0 || canonical.Reasoning == nil || canonical.Currency == "" {
					continue
				}
				if model.ContextWindow == nil {
					model.ContextWindow = canonical.ContextLimit
				}
				if model.MaxTokens == nil {
					model.MaxTokens = canonical.MaxOutputTokens
				}
				if model.Reasoning == nil {
					model.Reasoning = canonical.Reasoning
				}
				if canonical.InputTokenCost != nil && *canonical.InputTokenCost >= 0 && canonical.OutputTokenCost != nil && *canonical.OutputTokenCost >= 0 {
					cost := map[string]any{"input": *canonical.InputTokenCost, "output": *canonical.OutputTokenCost, "currency": canonical.Currency}
					if canonical.CacheReadTokenCost != nil && *canonical.CacheReadTokenCost >= 0 {
						cost["cacheRead"] = *canonical.CacheReadTokenCost
					}
					if canonical.CacheWriteTokenCost != nil && *canonical.CacheWriteTokenCost >= 0 {
						cost["cacheWrite"] = *canonical.CacheWriteTokenCost
					}
					model.Cost = cost
				}
			}
		}()
	}
send:
	for index := range models {
		if !models[index].Available {
			continue
		}
		select {
		case jobs <- index:
		case <-ctx.Done():
			completeMu.Lock()
			complete = false
			completeMu.Unlock()
			break send
		}
	}
	close(jobs)
	workers.Wait()
	return complete
}

func (a *GooseAdmin) RefreshModels(ctx context.Context) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var refresh struct {
		Started []string `json:"started"`
		Skipped []struct {
			ProviderID string `json:"providerId"`
			Reason     string `json:"reason"`
		} `json:"skipped"`
	}
	if err := a.call(ctx, "_goose/unstable/providers/inventory/refresh", map[string]any{"providerIds": []string{}}, &refresh); err != nil {
		return nil, err
	}
	started := make(map[string]bool, len(refresh.Started))
	for _, providerID := range refresh.Started {
		started[providerID] = true
	}
	for _, skipped := range refresh.Skipped {
		if skipped.Reason == "already_refreshing" || skipped.Reason == "alreadyRefreshing" {
			started[skipped.ProviderID] = true
			refresh.Started = append(refresh.Started, skipped.ProviderID)
		}
	}
	for len(started) > 0 {
		providers, err := a.providers(ctx, refresh.Started)
		if err != nil {
			return nil, err
		}
		seen := make(map[string]bool, len(providers))
		for _, provider := range providers {
			seen[provider.ProviderID] = true
			if started[provider.ProviderID] && !provider.Refreshing {
				delete(started, provider.ProviderID)
			}
		}
		for providerID := range started {
			if !seen[providerID] {
				return nil, fmt.Errorf("Goose model refresh lost provider %s", providerID)
			}
		}
		if len(started) == 0 {
			break
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("wait for Goose model refresh: %w", ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	models, metadataComplete, err := a.models(ctx)
	return map[string]any{"models": models, "complete": metadataComplete}, err
}

func (a *GooseAdmin) DefaultModel(ctx context.Context) (map[string]any, error) {
	models, err := a.Models(ctx)
	if err != nil {
		return nil, err
	}
	var selected *WireModel
	for index := range models {
		if models[index].Available && !models[index].Hidden {
			selected = &models[index]
			break
		}
	}
	return map[string]any{"model": selected, "thinkingLevel": "off"}, nil
}

func (a *GooseAdmin) SetModelVisibility(ctx context.Context, provider, id string, hidden bool) ([]WireModel, error) {
	models, err := a.Models(ctx)
	if err != nil {
		return nil, err
	}
	found := false
	for _, model := range models {
		if model.Provider == provider && model.ID == id {
			found = true
		}
	}
	if !found {
		return nil, fmt.Errorf("unknown model: %s/%s", provider, id)
	}
	config, err := a.settings.Get()
	if err != nil {
		return nil, err
	}
	refs := config.HiddenModels[:0]
	for _, ref := range config.HiddenModels {
		if ref.Provider != provider || ref.ID != id {
			refs = append(refs, ref)
		}
	}
	if hidden {
		refs = append(refs, ModelReference{Provider: provider, ID: id})
	}
	if _, err := a.settings.Update(AppConfigPatch{HiddenModels: &refs}); err != nil {
		return nil, err
	}
	for index := range models {
		if models[index].Provider == provider && models[index].ID == id {
			models[index].Hidden = hidden
		}
	}
	return models, nil
}

func (a *GooseAdmin) SetAllModelVisibility(ctx context.Context, hidden bool) ([]WireModel, error) {
	models, err := a.Models(ctx)
	if err != nil {
		return nil, err
	}
	refs := []ModelReference{}
	for index := range models {
		models[index].Hidden = hidden
		if hidden {
			refs = append(refs, ModelReference{Provider: models[index].Provider, ID: models[index].ID})
		}
	}
	if _, err := a.settings.Update(AppConfigPatch{HiddenModels: &refs}); err != nil {
		return nil, err
	}
	return models, nil
}

func (a *GooseAdmin) ProviderStatus(ctx context.Context) (map[string]any, error) {
	providers, err := a.providers(ctx, nil)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(providers))
	for _, provider := range providers {
		configured := boolDefault(provider.Configured, false)
		if !boolDefault(provider.VisibleInSetup, true) && !configured {
			continue
		}
		available := providerRuntimeAvailable(provider)
		canOAuth, canAPIKey := false, false
		for _, key := range provider.ConfigKeys {
			canOAuth = canOAuth || key.OAuthFlow
			canAPIKey = canAPIKey || (!key.OAuthFlow && (key.Primary || key.Required))
		}
		kind := "other"
		if !configured && canOAuth {
			kind = "oauth"
		} else if !configured && canAPIKey {
			kind = "api-key"
		}
		name := provider.ProviderName
		if name == "" {
			name = provider.Name
		}
		if name == "" {
			name = provider.ProviderID
		}
		item := map[string]any{"id": provider.ProviderID, "name": name, "configured": configured, "available": available, "kind": kind, "canOAuth": canOAuth, "canApiKey": canAPIKey, "canLogout": configured && len(provider.ConfigKeys) > 0, "acp": provider.ACP, "modelCount": len(provider.Models), "availableModelCount": 0}
		if configured && available {
			item["availableModelCount"] = len(provider.Models)
		}
		if provider.LastRefreshError != "" {
			item["detail"] = provider.LastRefreshError
		} else if !available {
			item["detail"] = "Provider runtime is unavailable"
		}
		result = append(result, item)
	}
	return map[string]any{"providers": result}, nil
}

func providerRuntimeAvailable(provider gooseProvider) bool {
	return boolDefault(provider.Available, true) && provider.LastRefreshError == ""
}

func (a *GooseAdmin) ProviderReadiness(ctx context.Context, providerID string) (map[string]any, error) {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" || containsNUL(providerID) {
		return nil, fmt.Errorf("invalid provider identifier")
	}
	providers, err := a.providers(ctx, []string{providerID})
	if err != nil {
		return nil, err
	}
	if len(providers) != 1 || providers[0].ProviderID != providerID || !providers[0].ACP {
		return nil, fmt.Errorf("provider does not support ACP readiness checks")
	}
	var response struct {
		ProviderID string  `json:"providerId"`
		Ready      *bool   `json:"ready"`
		Error      *string `json:"error"`
	}
	if err := a.call(ctx, "_goose/unstable/providers/readiness/check", map[string]any{"providerId": providerID}, &response); err != nil {
		return nil, err
	}
	if response.ProviderID != providerID || response.Ready == nil {
		return nil, fmt.Errorf("Goose readiness response is invalid")
	}
	return map[string]any{"providerId": providerID, "ready": *response.Ready, "hasIssue": response.Error != nil}, nil
}

func (a *GooseAdmin) LogoutProvider(ctx context.Context, providerID string) error {
	if providerID == "" || containsNUL(providerID) {
		return fmt.Errorf("invalid provider identifier")
	}
	var ignored any
	return a.call(ctx, "_goose/unstable/providers/config/delete", map[string]any{"providerId": providerID}, &ignored)
}

type GoosePreferences struct {
	AutoCompactThreshold *float64 `json:"autoCompactThreshold,omitempty"`
	GooseThinkingEffort  *string  `json:"gooseThinkingEffort,omitempty"`
}

func (a *GooseAdmin) ReadPreferences(ctx context.Context) (GoosePreferences, error) {
	var response struct {
		Values []struct {
			Key   string `json:"key"`
			Value any    `json:"value"`
		} `json:"values"`
	}
	if err := a.call(ctx, "_goose/unstable/preferences/read", map[string]any{"keys": []string{"autoCompactThreshold", "gooseThinkingEffort"}}, &response); err != nil {
		return GoosePreferences{}, err
	}
	if response.Values == nil {
		return GoosePreferences{}, fmt.Errorf("Goose preferences response is missing values")
	}
	return normalizePreferences(response.Values)
}

func (a *GooseAdmin) SavePreferences(ctx context.Context, preferences GoosePreferences) (GoosePreferences, error) {
	values, err := preferenceValues(preferences)
	if err != nil {
		return GoosePreferences{}, err
	}
	if len(values) > 0 {
		var ignored any
		if err := a.call(ctx, "_goose/unstable/preferences/save", map[string]any{"values": values}, &ignored); err != nil {
			return GoosePreferences{}, err
		}
	}
	return a.ReadPreferences(ctx)
}

func (a *GooseAdmin) ResetPreferences(ctx context.Context, keys []string) (GoosePreferences, error) {
	if len(keys) < 1 || len(keys) > 2 {
		return GoosePreferences{}, fmt.Errorf("malformed Goose preferences request")
	}
	seen := make(map[string]bool)
	configKeys := make([]string, 0, len(keys))
	for _, key := range keys {
		if seen[key] || (key != "autoCompactThreshold" && key != "gooseThinkingEffort") {
			return GoosePreferences{}, fmt.Errorf("malformed Goose preferences request")
		}
		seen[key] = true
		if key == "autoCompactThreshold" {
			configKeys = append(configKeys, "GOOSE_AUTO_COMPACT_THRESHOLD")
		} else {
			configKeys = append(configKeys, "GOOSE_THINKING_EFFORT")
		}
	}
	for _, key := range configKeys {
		if err := a.call(ctx, "_goose/unstable/config/remove", map[string]any{"key": key, "isSecret": false}, nil); err != nil {
			return GoosePreferences{}, err
		}
	}
	return a.ReadPreferences(ctx)
}

type GooseProviderDefaults struct {
	ProviderID *string `json:"providerId"`
	ModelID    *string `json:"modelId"`
}

func (a *GooseAdmin) ReadDefaults(ctx context.Context) (GooseProviderDefaults, error) {
	var response GooseProviderDefaults
	err := a.call(ctx, "_goose/unstable/defaults/read", map[string]any{}, &response)
	return response, err
}

func (a *GooseAdmin) SaveDefaults(ctx context.Context, providerID string, modelID *string) (GooseProviderDefaults, error) {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" || containsNUL(providerID) || modelID != nil && (strings.TrimSpace(*modelID) == "" || containsNUL(*modelID)) {
		return GooseProviderDefaults{}, fmt.Errorf("malformed Goose defaults request")
	}
	providers, err := a.providers(ctx, nil)
	if err != nil {
		return GooseProviderDefaults{}, err
	}
	valid := false
	for _, provider := range providers {
		if provider.ProviderID == providerID && boolDefault(provider.Configured, false) && providerRuntimeAvailable(provider) {
			valid = true
		}
	}
	if !valid {
		return GooseProviderDefaults{}, fmt.Errorf("selected default provider is unavailable")
	}
	var response GooseProviderDefaults
	if err := a.call(ctx, "_goose/unstable/defaults/save", map[string]any{"providerId": providerID, "modelId": modelID}, &response); err != nil {
		return GooseProviderDefaults{}, err
	}
	if response.ProviderID == nil || *response.ProviderID != providerID || !equalOptionalString(response.ModelID, modelID) {
		return GooseProviderDefaults{}, fmt.Errorf("Goose default response does not match the request")
	}
	return response, nil
}

func (a *GooseAdmin) ClearDefaults(ctx context.Context) (GooseProviderDefaults, error) {
	var response GooseProviderDefaults
	if err := a.call(ctx, "_goose/unstable/defaults/clear", map[string]any{}, &response); err != nil {
		return GooseProviderDefaults{}, err
	}
	if response.ProviderID != nil || response.ModelID != nil {
		return GooseProviderDefaults{}, fmt.Errorf("Goose default clear response is invalid")
	}
	return response, nil
}

func (a *GooseAdmin) call(ctx context.Context, method string, params any, destination any) error {
	raw, err := a.client.CallGoose(ctx, method, params)
	if err != nil {
		return gooseAdministrationError{cause: err}
	}
	if destination == nil || len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	if err := json.Unmarshal(raw, destination); err != nil {
		return fmt.Errorf("decode Goose response for %s: %w", method, err)
	}
	return nil
}

// Administration errors may include upstream configuration or credentials.
// Retain the cause for inspection without exposing it through the browser wire.
type gooseAdministrationError struct{ cause error }

func (e gooseAdministrationError) Error() string {
	return "Goose could not complete the administration request"
}
func (e gooseAdministrationError) Unwrap() error { return e.cause }

func normalizePreferences(values []struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}) (GoosePreferences, error) {
	result := GoosePreferences{}
	seen := make(map[string]bool)
	for _, entry := range values {
		if seen[entry.Key] {
			return GoosePreferences{}, fmt.Errorf("Goose preferences response is invalid")
		}
		seen[entry.Key] = true
		switch entry.Key {
		case "autoCompactThreshold":
			if entry.Value == nil {
				continue
			}
			value, ok := entry.Value.(float64)
			if !ok || value <= 0 || value > 1 {
				return GoosePreferences{}, fmt.Errorf("Goose auto compact threshold is invalid")
			}
			result.AutoCompactThreshold = &value
		case "gooseThinkingEffort":
			if entry.Value == nil {
				continue
			}
			value, ok := entry.Value.(string)
			if !ok || !map[string]bool{"off": true, "low": true, "medium": true, "high": true, "max": true}[value] {
				return GoosePreferences{}, fmt.Errorf("Goose thinking effort is invalid")
			}
			result.GooseThinkingEffort = &value
		default:
			return GoosePreferences{}, fmt.Errorf("Goose preferences response is invalid")
		}
	}
	return result, nil
}

func preferenceValues(value GoosePreferences) ([]map[string]any, error) {
	result := []map[string]any{}
	if value.AutoCompactThreshold != nil {
		if *value.AutoCompactThreshold <= 0 || *value.AutoCompactThreshold > 1 {
			return nil, fmt.Errorf("malformed Goose preferences request")
		}
		result = append(result, map[string]any{"key": "autoCompactThreshold", "value": *value.AutoCompactThreshold})
	}
	if value.GooseThinkingEffort != nil {
		if !map[string]bool{"off": true, "low": true, "medium": true, "high": true, "max": true}[*value.GooseThinkingEffort] {
			return nil, fmt.Errorf("malformed Goose preferences request")
		}
		result = append(result, map[string]any{"key": "gooseThinkingEffort", "value": *value.GooseThinkingEffort})
	}
	return result, nil
}

func boolDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func equalOptionalString(left, right *string) bool {
	return left == nil && right == nil || left != nil && right != nil && *left == *right
}
