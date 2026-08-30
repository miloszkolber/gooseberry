package controller

import (
	"context"
	"fmt"
)

type connectionGenerationKey struct{}

func (entry *sessionEntry) context(ctx context.Context) context.Context {
	entry.state.Lock()
	generation := entry.attached
	entry.state.Unlock()
	return context.WithValue(ctx, connectionGenerationKey{}, generation)
}

// Waiting for an operation does not grant authority over a replaced projection.
func (m *SessionManager) lockEntry(sessionID string, entry *sessionEntry) error {
	entry.op.Lock()
	m.mu.Lock()
	current := !m.closed && m.sessions[sessionID] == entry && !m.lifecycle[sessionID]
	m.mu.Unlock()
	if !current {
		entry.op.Unlock()
		return fmt.Errorf("session changed while waiting for an operation")
	}
	return nil
}

// Reserve lifecycle changes before sending them to Goose, including for an
// unloaded archived session. The caller already owns entry.op when entry != nil.
func (m *SessionManager) beginLifecycle(sessionID string, entry *sessionEntry) (func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.sessions[sessionID]
	allowedRefs := 0
	if entry != nil {
		if current != entry {
			return nil, fmt.Errorf("session changed while waiting for an operation")
		}
		allowedRefs = 1
	}
	if m.closed || m.lifecycle[sessionID] || current != nil && current.refs > allowedRefs {
		return nil, fmt.Errorf("wait for the chat to finish loading or updating")
	}
	if current != nil {
		current.state.Lock()
		running := current.streaming || current.runID != ""
		current.state.Unlock()
		if running {
			return nil, fmt.Errorf("stop the running chat before changing its lifecycle")
		}
	}
	if m.lifecycle == nil {
		m.lifecycle = make(map[string]bool)
	}
	m.lifecycle[sessionID] = true
	return func() {
		m.mu.Lock()
		delete(m.lifecycle, sessionID)
		m.mu.Unlock()
	}, nil
}
