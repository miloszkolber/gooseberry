package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/miloszkolber/gooseberry/internal/identifier"
)

type deferredResponse struct {
	result any
	after  func()
}

type providerLogin struct {
	id, providerID, clientKey, kind string
	fields                          []gooseProviderConfigKey
	index                           int
	values                          []map[string]string
	inFlight, cancelled             bool
	ctx                             context.Context
	cancel                          context.CancelFunc
	timer                           *time.Timer
}

type loginSnapshot struct {
	push  map[string]any
	timer *time.Timer
}

type ProviderLogins struct {
	mu        sync.Mutex
	admin     *GooseAdmin
	pending   map[string]*providerLogin
	snapshots map[string]loginSnapshot
	publish   func(string, any)
	closed    bool
}

func NewProviderLogins(admin *GooseAdmin, publish func(string, any)) *ProviderLogins {
	return &ProviderLogins{admin: admin, pending: make(map[string]*providerLogin), snapshots: make(map[string]loginSnapshot), publish: publish}
}

func (p *ProviderLogins) Start(ctx context.Context, clientKey, providerID, kind string) (any, error) {
	if kind != "oauth" && kind != "api_key" {
		return nil, fmt.Errorf("invalid provider login type")
	}
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, fmt.Errorf("controller is shutting down")
	}
	for _, login := range p.pending {
		if login.clientKey == clientKey || login.providerID == providerID {
			p.mu.Unlock()
			return nil, fmt.Errorf("another provider connection is already in progress")
		}
	}
	loginContext, cancel := context.WithCancel(context.Background())
	login := &providerLogin{id: identifier.New(), providerID: providerID, clientKey: clientKey, kind: kind, ctx: loginContext, cancel: cancel, inFlight: true, values: []map[string]string{}}
	p.pending[login.id] = login
	login.timer = time.AfterFunc(10*time.Minute, func() { p.expire(login) })
	p.mu.Unlock()
	fail := func(err error) (any, error) { p.remove(login); return nil, err }
	providers, err := p.admin.providers(ctx, []string{providerID})
	if err != nil {
		return fail(err)
	}
	var provider *gooseProvider
	for index := range providers {
		if providers[index].ProviderID == providerID {
			provider = &providers[index]
			break
		}
	}
	if provider == nil {
		return fail(fmt.Errorf("unknown provider: %s", providerID))
	}
	frame := map[string]any{"kind": "progress", "message": "Waiting for Goose authentication…"}
	var after func()
	if kind == "oauth" {
		canOAuth := false
		for _, field := range provider.ConfigKeys {
			canOAuth = canOAuth || field.OAuthFlow
		}
		if !canOAuth {
			return fail(fmt.Errorf("provider does not support native authentication"))
		}
		after = func() { go p.authenticate(login) }
	} else {
		var current struct {
			Fields []struct {
				Key   string `json:"key"`
				IsSet bool   `json:"isSet"`
			} `json:"fields"`
		}
		if err := p.admin.call(ctx, "_goose/unstable/providers/config/read", map[string]any{"providerId": providerID}, &current); err != nil {
			return fail(err)
		}
		configured := make(map[string]bool)
		for _, field := range current.Fields {
			if field.IsSet {
				configured[field.Key] = true
			}
		}
		manual := false
		for _, field := range provider.ConfigKeys {
			if !field.OAuthFlow && (field.Primary || field.Required) {
				manual = true
				if !configured[field.Name] {
					login.fields = append(login.fields, field)
				}
			}
		}
		if !manual {
			return fail(fmt.Errorf("provider does not accept configuration fields"))
		}
		if len(login.fields) == 0 {
			frame["message"] = "Checking provider configuration…"
			after = func() { go p.save(login) }
		} else {
			frame = providerFieldFrame(login.fields[0])
		}
	}
	p.mu.Lock()
	if p.pending[login.id] != login || login.cancelled {
		p.removeLocked(login)
		p.mu.Unlock()
		return nil, fmt.Errorf("provider connection expired")
	}
	login.inFlight = after != nil
	p.cacheLocked(login, frame)
	p.mu.Unlock()
	result := map[string]any{"loginId": login.id, "frame": frame}
	if after != nil {
		return deferredResponse{result: result, after: after}, nil
	}
	return result, nil
}

func (p *ProviderLogins) Reply(clientKey, loginID, value string) error {
	p.mu.Lock()
	login := p.pending[loginID]
	if login == nil || login.clientKey != clientKey || login.kind != "api_key" || login.cancelled || login.inFlight || login.index >= len(login.fields) {
		p.mu.Unlock()
		return fmt.Errorf("unknown or expired provider connection")
	}
	field := login.fields[login.index]
	if strings.TrimSpace(value) == "" {
		value = field.Default
	} else if !field.Secret {
		value = strings.TrimSpace(value)
	}
	if value == "" {
		p.mu.Unlock()
		return fmt.Errorf("%s cannot be empty", field.Name)
	}
	login.values = append(login.values, map[string]string{"key": field.Name, "value": value})
	login.index++
	if login.index < len(login.fields) {
		push := p.cacheLocked(login, providerFieldFrame(login.fields[login.index]))
		p.mu.Unlock()
		p.send(login.clientKey, push)
		return nil
	}
	login.inFlight = true
	p.mu.Unlock()
	p.save(login)
	return nil
}

func (p *ProviderLogins) save(login *providerLogin) {
	p.mu.Lock()
	if p.pending[login.id] != login || login.cancelled {
		p.removeLocked(login)
		p.mu.Unlock()
		return
	}
	values := append([]map[string]string{}, login.values...)
	p.mu.Unlock()
	p.frame(login, map[string]any{"kind": "progress", "message": "Saving provider configuration…"})
	_, err := p.admin.client.CallGooseUntilDone(login.ctx, "_goose/unstable/providers/config/save", map[string]any{"providerId": login.providerID, "fields": values})
	p.finish(login, err)
}

func (p *ProviderLogins) authenticate(login *providerLogin) {
	p.mu.Lock()
	if p.pending[login.id] != login || login.cancelled {
		p.removeLocked(login)
		p.mu.Unlock()
		return
	}
	p.mu.Unlock()
	_, err := p.admin.client.CallGooseUntilDone(login.ctx, "_goose/unstable/providers/config/authenticate", map[string]any{"providerId": login.providerID})
	p.finish(login, err)
}

func (p *ProviderLogins) DeviceCode(value map[string]any) {
	providerID := textValue(value["providerId"])
	verificationURI := textValue(value["verificationUri"])
	p.mu.Lock()
	for _, login := range p.pending {
		if login.providerID == providerID && login.kind == "oauth" && !login.cancelled {
			if !safeProviderLoginURL(verificationURI) {
				push := p.cacheLocked(login, map[string]any{"kind": "error", "message": "Goose returned an invalid provider sign-in URL."})
				p.removeLocked(login)
				p.mu.Unlock()
				p.send(login.clientKey, push)
				return
			}
			push := p.cacheLocked(login, map[string]any{"kind": "deviceCode", "userCode": textValue(value["userCode"]), "verificationUri": verificationURI, "expiresInSeconds": integerValue(value["expiresIn"])})
			p.mu.Unlock()
			p.send(login.clientKey, push)
			return
		}
	}
	p.mu.Unlock()
}

func safeProviderLoginURL(value string) bool {
	if value == "" || len(value) > 2_048 || strings.IndexFunc(value, func(character rune) bool { return character <= 0x20 || character == 0x7f }) >= 0 {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Hostname() != "" && parsed.User == nil
}

func (p *ProviderLogins) Cancel(clientKey, loginID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	login := p.pending[loginID]
	snapshot := p.snapshots[clientKey]
	if (login == nil || login.clientKey != clientKey) && snapshot.push["loginId"] != loginID {
		return fmt.Errorf("unknown or expired provider connection")
	}
	if login != nil && login.clientKey == clientKey {
		login.cancelled = true
		if !login.inFlight {
			p.removeLocked(login)
		}
	}
	if snapshot.push["loginId"] == loginID {
		snapshot.timer.Stop()
		delete(p.snapshots, clientKey)
	}
	return nil
}

func (p *ProviderLogins) Snapshot(clientKey string) any {
	p.mu.Lock()
	defer p.mu.Unlock()
	if snapshot, ok := p.snapshots[clientKey]; ok {
		return snapshot.push
	}
	return nil
}

func (p *ProviderLogins) frame(login *providerLogin, frame map[string]any) {
	p.mu.Lock()
	if p.pending[login.id] != login || login.cancelled {
		p.mu.Unlock()
		return
	}
	push := p.cacheLocked(login, frame)
	p.mu.Unlock()
	p.send(login.clientKey, push)
}

func (p *ProviderLogins) finish(login *providerLogin, err error) {
	p.mu.Lock()
	if p.pending[login.id] != login {
		p.mu.Unlock()
		return
	}
	var push map[string]any
	if !login.cancelled {
		frame := map[string]any{"kind": "success"}
		if err != nil {
			frame = map[string]any{"kind": "error", "message": "Goose could not connect this provider. Check the configuration and try again."}
		}
		push = p.cacheLocked(login, frame)
	}
	p.removeLocked(login)
	p.mu.Unlock()
	if push != nil {
		p.send(login.clientKey, push)
	}
}

func (p *ProviderLogins) expire(login *providerLogin) {
	p.mu.Lock()
	if p.pending[login.id] != login {
		p.mu.Unlock()
		return
	}
	var push map[string]any
	if !login.cancelled {
		push = p.cacheLocked(login, map[string]any{"kind": "error", "message": "Provider connection timed out."})
	}
	inFlight := login.inFlight
	login.cancelled = true
	p.removeLocked(login)
	p.mu.Unlock()
	if inFlight {
		p.admin.client.Reset()
	}
	if push != nil {
		p.send(login.clientKey, push)
	}
}

func (p *ProviderLogins) cacheLocked(login *providerLogin, frame map[string]any) map[string]any {
	if current, ok := p.snapshots[login.clientKey]; ok {
		current.timer.Stop()
	}
	push := map[string]any{"loginId": login.id, "providerId": login.providerID, "frame": frame}
	encoded, _ := json.Marshal(push)
	var snapshot map[string]any
	_ = json.Unmarshal(encoded, &snapshot)
	var timer *time.Timer
	timer = time.AfterFunc(time.Minute, func() {
		p.mu.Lock()
		if p.snapshots[login.clientKey].timer == timer {
			delete(p.snapshots, login.clientKey)
		}
		p.mu.Unlock()
	})
	p.snapshots[login.clientKey] = loginSnapshot{push: snapshot, timer: timer}
	return snapshot
}

func (p *ProviderLogins) remove(login *providerLogin) {
	p.mu.Lock()
	p.removeLocked(login)
	p.mu.Unlock()
}
func (p *ProviderLogins) removeLocked(login *providerLogin) {
	if p.pending[login.id] != login {
		return
	}
	login.timer.Stop()
	login.cancel()
	login.values = nil
	delete(p.pending, login.id)
}
func (p *ProviderLogins) send(clientKey string, push any) {
	if p.publish != nil {
		p.publish(clientKey, push)
	}
}

func (p *ProviderLogins) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	for _, login := range p.pending {
		p.removeLocked(login)
	}
	for key, snapshot := range p.snapshots {
		snapshot.timer.Stop()
		delete(p.snapshots, key)
	}
}

func providerFieldFrame(field gooseProviderConfigKey) map[string]any {
	result := map[string]any{"kind": "prompt", "message": "Enter " + field.Name, "secret": field.Secret}
	if field.Default != "" {
		result["placeholder"], result["allowEmpty"] = field.Default, true
	}
	return result
}
