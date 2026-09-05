package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"
)

const (
	// This checkpoint exists only inside the local newline adapter. It is
	// never sent to the agent, advertised as a capability or published to UI.
	notificationCheckpoint  = "_gooseberry/internal/notification-checkpoint"
	maxPendingNotifications = 128
)

// The SDK's notification queue fails immediately at 1,024 entries. A local
// checkpoint passes through that same ordered queue after each small batch.
// Waiting for its callback applies transport backpressure without losing the
// SDK's response watermark, decoding, cancellation or request dispatch rules.
// Notification callbacks must not synchronously call back into the agent (the
// SDK's response watermark already prohibits that); inbound RPC request handlers
// remain independent and can reply while notifications drain.
func (s *acpWebSocketStream) frameIncoming(payload []byte) error {
	var header struct {
		ID     *json.RawMessage `json:"id"`
		Method string           `json:"method"`
	}
	if err := json.Unmarshal(payload, &header); err != nil {
		return fmt.Errorf("ACP WebSocket received invalid JSON")
	}
	if header.Method == notificationCheckpoint {
		return fmt.Errorf("ACP WebSocket received a reserved internal method")
	}
	if bytes.ContainsAny(payload, "\r\n") {
		var compact bytes.Buffer
		if err := json.Compact(&compact, payload); err != nil {
			return fmt.Errorf("ACP WebSocket received invalid JSON")
		}
		payload = compact.Bytes()
	}
	s.readBuffer = append(payload, '\n')
	if header.Method != "" && header.ID == nil && header.Method != "$/cancel_request" {
		s.queuedNotifications++
		if s.queuedNotifications == maxPendingNotifications {
			s.readBuffer = append(s.readBuffer, []byte(`{"jsonrpc":"2.0","method":"`+notificationCheckpoint+`","params":{}}`+"\n")...)
			s.queuedNotifications = 0
			s.waitForDrain = true
		}
	}
	return nil
}

func (s *acpWebSocketStream) awaitNotifications() error {
	timer := time.NewTimer(15 * time.Second)
	defer timer.Stop()
	select {
	case <-s.drained:
		return nil
	case <-s.ctx.Done():
		return s.ctx.Err()
	case <-timer.C:
		return fmt.Errorf("ACP notification processing stalled")
	}
}
