package controller

import (
	"context"
	"encoding/json"
)

type canonicalModelInfo struct {
	Provider            string   `json:"provider"`
	Model               string   `json:"model"`
	ContextLimit        *int     `json:"contextLimit"`
	MaxOutputTokens     *int     `json:"maxOutputTokens"`
	Reasoning           *bool    `json:"reasoning"`
	Currency            string   `json:"currency"`
	InputTokenCost      *float64 `json:"inputTokenCost"`
	OutputTokenCost     *float64 `json:"outputTokenCost"`
	CacheReadTokenCost  *float64 `json:"cacheReadTokenCost"`
	CacheWriteTokenCost *float64 `json:"cacheWriteTokenCost"`
}

type canonicalKey struct {
	generation      uint64
	provider, model string
}

type canonicalFlight struct {
	done      chan struct{}
	cancel    context.CancelFunc
	consumers int
	started   bool
	result    *canonicalModelInfo
}

// A projection can stop waiting without releasing an upstream concurrency slot.
// Only queued work with no remaining consumers is cancelled; completed metadata
// is never cached, so a later inventory request queries Goose again.
func (a *GooseAdmin) canonicalModel(ctx context.Context, provider, model string) *canonicalModelInfo {
	generation, err := a.client.Ready(ctx)
	if err != nil || ctx.Err() != nil {
		return nil
	}
	key := canonicalKey{generation: generation, provider: provider, model: model}
	a.canonicalMu.Lock()
	flight := a.canonicalFlights[key]
	if flight == nil {
		waiting, cancel := context.WithCancel(context.Background())
		flight = &canonicalFlight{done: make(chan struct{}), cancel: cancel}
		a.canonicalFlights[key] = flight
		go a.lookupCanonical(waiting, key, flight)
	}
	flight.consumers++
	a.canonicalMu.Unlock()
	defer func() {
		a.canonicalMu.Lock()
		flight.consumers--
		if flight.consumers == 0 && !flight.started {
			flight.cancel()
			if a.canonicalFlights[key] == flight {
				delete(a.canonicalFlights, key)
			}
		}
		a.canonicalMu.Unlock()
	}()
	select {
	case <-flight.done:
		return flight.result
	case <-ctx.Done():
		return nil
	}
}

func (a *GooseAdmin) lookupCanonical(ctx context.Context, key canonicalKey, flight *canonicalFlight) {
	defer func() {
		a.canonicalMu.Lock()
		if a.canonicalFlights[key] == flight {
			delete(a.canonicalFlights, key)
		}
		close(flight.done)
		flight.cancel()
		a.canonicalMu.Unlock()
	}()
	select {
	case a.canonicalSlots <- struct{}{}:
		defer func() { <-a.canonicalSlots }()
	case <-ctx.Done():
		return
	}
	a.canonicalMu.Lock()
	flight.started = flight.consumers > 0
	started := flight.started
	a.canonicalMu.Unlock()
	if !started || ctx.Err() != nil {
		return
	}
	if generation, err := a.client.Ready(ctx); err != nil || generation != key.generation {
		return
	}
	raw, err := a.client.CallGooseUntilDone(ctx, "_goose/unstable/providers/canonical-model-info", map[string]any{"provider": key.provider, "model": key.model})
	if err != nil {
		return
	}
	var response struct {
		ModelInfo *canonicalModelInfo `json:"modelInfo"`
	}
	if json.Unmarshal(raw, &response) == nil {
		flight.result = response.ModelInfo
	}
}
