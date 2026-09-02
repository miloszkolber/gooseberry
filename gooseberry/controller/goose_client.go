package controller

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	acp "github.com/coder/acp-go-sdk"
	"github.com/coder/websocket"
)

const (
	defaultGooseURL      = "ws://127.0.0.1:3284/acp"
	defaultGooseTimeout  = 30 * time.Second
	maxAgentNameRunes    = 128
	maxAgentVersionRunes = 64
	// Matches the Web UI socket ceiling and accommodates a maximally escaped
	// App resource plus its bounded JSON-RPC envelope.
	gooseReadLimit = 32 * 1024 * 1024
)

type GooseEvents interface {
	SessionUpdate(context.Context, acp.SessionNotification) error
	Extension(context.Context, string, json.RawMessage) error
	Permission(context.Context, acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error)
}

type GooseClient struct {
	URL            string
	SecretKey      string
	Version        string
	Timeout        time.Duration
	Events         GooseEvents
	requireSecret  bool
	requireGoose   bool
	profileChanged func(AgentProfile)

	mu         sync.Mutex
	connection *gooseConnection
	connecting *gooseConnectAttempt
	closed     bool
	generation uint64

	notificationMu     sync.Mutex
	notifiedGeneration uint64
}

type gooseConnectAttempt struct {
	done   chan struct{}
	cancel context.CancelFunc
	err    error // Written before done closes.
}

type gooseConnection struct {
	client  *acp.ClientSideConnection
	stream  *acpWebSocketStream
	cancel  context.CancelFunc
	sink    *gooseSink
	profile AgentProfile
}

func NewGooseClient(url, secret, version string, events GooseEvents) *GooseClient {
	requireSecret := url == ""
	requireGoose := url == ""
	if url == "" {
		url = defaultGooseURL
	}
	return &GooseClient{URL: url, SecretKey: secret, Version: version, Timeout: defaultGooseTimeout, Events: events, requireSecret: requireSecret, requireGoose: requireGoose}
}

func (c *GooseClient) Ready(ctx context.Context) (uint64, error) {
	generation, _, err := c.Profile(ctx)
	return generation, err
}

// Profile returns the connection generation and the capabilities negotiated
// by that same connection. The returned profile does not share mutable storage
// with the connection.
func (c *GooseClient) Profile(ctx context.Context) (generation uint64, profile AgentProfile, err error) {
	connection, generation, err := c.ready(ctx)
	if err != nil {
		return 0, AgentProfile{}, err
	}
	select {
	case <-connection.client.Done():
		c.drop(connection)
		return 0, AgentProfile{}, fmt.Errorf("ACP agent connection closed")
	default:
		return generation, cloneAgentProfile(connection.profile), nil
	}
}

func (c *GooseClient) ready(ctx context.Context) (*gooseConnection, uint64, error) {
	waited := false
	for {
		if err := ctx.Err(); err != nil {
			return nil, 0, err
		}
		c.mu.Lock()
		if c.closed {
			c.mu.Unlock()
			return nil, 0, fmt.Errorf("ACP client has been shut down")
		}
		if expected, attached := ctx.Value(connectionGenerationKey{}).(uint64); attached {
			if expected == 0 || c.connection == nil || c.generation != expected || isDone(c.connection) {
				c.mu.Unlock()
				return nil, 0, fmt.Errorf("ACP connection changed; reload the chat before retrying")
			}
		}
		previous := c.connection
		if previous != nil && !isDone(previous) {
			generation := c.generation
			c.mu.Unlock()
			return previous, generation, nil
		}
		if waited {
			c.mu.Unlock()
			if previous != nil {
				c.drop(previous)
			}
			return nil, 0, fmt.Errorf("ACP connection closed during setup")
		}
		c.connection = nil
		attempt := c.connecting
		if attempt == nil {
			// Setup belongs to the client, not the first readiness probe's deadline.
			bounded, cancel := c.bounded(context.Background())
			attempt = &gooseConnectAttempt{done: make(chan struct{}), cancel: cancel}
			c.connecting = attempt
			// Never reuse a cancelled attempt's notification generation.
			c.generation++
			go c.connect(bounded, attempt, c.generation)
		}
		c.mu.Unlock()
		if previous != nil {
			previous.close()
		}
		select {
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		case <-attempt.done:
			if err := ctx.Err(); err != nil {
				return nil, 0, err
			}
			if attempt.err != nil {
				return nil, 0, attempt.err
			}
			waited = true
		}
	}
}

func (c *GooseClient) connect(ctx context.Context, attempt *gooseConnectAttempt, generation uint64) {
	defer attempt.cancel()
	connection, err := dialGoose(ctx, c.URL, c.SecretKey, c.Events, generation)
	if err == nil {
		// The SDK writes before waiting on the request context. Closing the stream
		// also interrupts a blocked initialize write on cancellation or shutdown.
		stop := context.AfterFunc(ctx, connection.close)
		connection.profile, err = c.initialize(ctx, connection)
		stop()
		if err == nil {
			connection.sink.goose.Store(connection.profile.Goose)
		}
		if ctx.Err() != nil {
			err = ctx.Err()
		}
	}
	var profileChanged func(AgentProfile)
	var profile AgentProfile
	c.mu.Lock()
	if c.connecting == attempt {
		c.connecting = nil
		if err == nil {
			c.connection = connection
			profileChanged = c.profileChanged
			profile = cloneAgentProfile(connection.profile)
		}
		attempt.err = err
		close(attempt.done)
	} else if err == nil {
		// Reset or Close retired this attempt while its network work completed.
		err = context.Canceled
	}
	c.mu.Unlock()
	if err != nil && connection != nil {
		connection.close()
	}
	if err == nil && profileChanged != nil {
		c.publishProfile(generation, profileChanged, profile)
	}
}

func (c *GooseClient) publishProfile(generation uint64, publish func(AgentProfile), profile AgentProfile) {
	c.notificationMu.Lock()
	defer c.notificationMu.Unlock()
	if generation <= c.notifiedGeneration {
		return
	}
	c.notifiedGeneration = generation
	publish(profile)
}

func (c *GooseClient) initialize(ctx context.Context, connection *gooseConnection) (AgentProfile, error) {
	version := c.Version
	if version == "" {
		version = "0.0.0"
	}
	response, err := connection.client.Initialize(ctx, acp.InitializeRequest{
		ProtocolVersion: acp.ProtocolVersion(acp.ProtocolVersionNumber),
		ClientInfo:      &acp.Implementation{Name: "gooseberry", Version: version},
		ClientCapabilities: acp.ClientCapabilities{
			Meta: map[string]any{"goose": map[string]any{
				"customNotifications": true,
				"mcpHostCapabilities": map[string]any{
					"extensions": map[string]any{
						"io.modelcontextprotocol/ui": map[string]any{
							"mimeTypes": []string{"text/html;profile=mcp-app"},
						},
					},
				},
			}},
		},
	})
	if err != nil {
		return AgentProfile{}, fmt.Errorf("initialize ACP agent: %w", err)
	}
	if response.ProtocolVersion != acp.ProtocolVersionNumber {
		return AgentProfile{}, fmt.Errorf("unsupported ACP protocol version %d (expected %d)", response.ProtocolVersion, acp.ProtocolVersionNumber)
	}
	profile := agentProfile(response)
	if c.requireGoose && !profile.Goose {
		return AgentProfile{}, fmt.Errorf("the packaged ACP endpoint must be recognized Goose")
	}
	return profile, nil
}

func agentProfile(response acp.InitializeResponse) AgentProfile {
	capabilities := response.AgentCapabilities
	profile := AgentProfile{MissingRequired: []string{}}
	rawName, rawVersion := "", ""
	if response.AgentInfo != nil {
		rawName = response.AgentInfo.Name
		rawVersion = response.AgentInfo.Version
		profile.Name = boundedAgentText(rawName, maxAgentNameRunes)
		profile.Version = boundedAgentText(rawVersion, maxAgentVersionRunes)
	}
	_, gooseMetadata := capabilities.Meta["goose"]
	profile.Goose = response.AgentInfo != nil && response.AgentInfo.Name == "goose" && gooseMetadata && capabilities.Meta["goose"] != nil
	profile.Operations = AgentOperations{
		DeleteSession:  capabilities.SessionCapabilities.Delete != nil,
		ForkSession:    capabilities.SessionCapabilities.Fork != nil || profile.Goose,
		PromptImage:    capabilities.PromptCapabilities.Image,
		HTTPMCP:        capabilities.McpCapabilities.Http,
		Steer:          profile.Goose,
		RenameSession:  profile.Goose,
		ArchiveSession: profile.Goose,
		Administration: profile.Goose,
	}
	if !profile.Goose && profile.Name != "" {
		profile.identity = agentProfileIdentityDigest(rawName, rawVersion, profile.Operations)
	}
	if !capabilities.LoadSession {
		profile.MissingRequired = append(profile.MissingRequired, "session/load")
	}
	if capabilities.SessionCapabilities.List == nil {
		profile.MissingRequired = append(profile.MissingRequired, "session/list")
	}
	profile.Compatible = len(profile.MissingRequired) == 0
	return profile
}

func cloneAgentProfile(profile AgentProfile) AgentProfile {
	profile.MissingRequired = append([]string{}, profile.MissingRequired...)
	return profile
}

func boundedAgentText(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := make([]rune, 0, min(len(value), limit))
	for _, character := range value {
		if unicode.IsControl(character) || unicode.Is(unicode.Cf, character) {
			continue
		}
		runes = append(runes, character)
		if len(runes) == limit {
			break
		}
	}
	return string(runes)
}

func agentProfileIdentityDigest(name, version string, operations AgentOperations) string {
	encoded, _ := json.Marshal(struct {
		Name       string          `json:"name"`
		Version    string          `json:"version"`
		Operations AgentOperations `json:"operations"`
	}{Name: name, Version: version, Operations: operations})
	digest := sha256.Sum256(encoded)
	return fmt.Sprintf("%x", digest)
}

func (c *GooseClient) CallGoose(ctx context.Context, method string, params any) (json.RawMessage, error) {
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return c.CallGooseUntilDone(bounded, method, params)
}

func (c *GooseClient) CallGooseUntilDone(ctx context.Context, method string, params any) (json.RawMessage, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return nil, err
	}
	if !connection.profile.Operations.Administration {
		return nil, unsupportedAgentCapability("Goose-specific operations")
	}
	result, err := connection.client.CallExtension(ctx, method, params)
	if err != nil {
		if isDone(connection) {
			c.drop(connection)
		}
		return nil, err
	}
	return result, nil
}

func (c *GooseClient) Reset() {
	c.disconnect(false)
}

func (c *GooseClient) ListSessions(ctx context.Context, request acp.ListSessionsRequest) (acp.ListSessionsResponse, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return acp.ListSessionsResponse{}, err
	}
	if !hasAgentCapability(connection.profile, "session/list") {
		return acp.ListSessionsResponse{}, unsupportedAgentCapability("session/list")
	}
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return connection.client.ListSessions(bounded, request)
}

func (c *GooseClient) NewSession(ctx context.Context, request acp.NewSessionRequest) (acp.NewSessionResponse, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return acp.NewSessionResponse{}, err
	}
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return connection.client.NewSession(bounded, request)
}

func (c *GooseClient) LoadSession(ctx context.Context, request acp.LoadSessionRequest) (acp.LoadSessionResponse, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return acp.LoadSessionResponse{}, err
	}
	if !hasAgentCapability(connection.profile, "session/load") {
		return acp.LoadSessionResponse{}, unsupportedAgentCapability("session/load")
	}
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return connection.client.LoadSession(bounded, request)
}

func (c *GooseClient) ForkSession(ctx context.Context, request acp.UnstableForkSessionRequest) (acp.UnstableForkSessionResponse, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return acp.UnstableForkSessionResponse{}, err
	}
	if !connection.profile.Operations.ForkSession {
		return acp.UnstableForkSessionResponse{}, unsupportedAgentCapability("session/fork")
	}
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return connection.client.UnstableForkSession(bounded, request)
}

func (c *GooseClient) DeleteSession(ctx context.Context, sessionID string) error {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return err
	}
	if !connection.profile.Operations.DeleteSession {
		return unsupportedAgentCapability("session/delete")
	}
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	_, err = connection.client.UnstableDeleteSession(bounded, acp.UnstableDeleteSessionRequest{SessionId: acp.SessionId(sessionID)})
	return err
}

func (c *GooseClient) Prompt(ctx context.Context, request acp.PromptRequest) (acp.PromptResponse, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return acp.PromptResponse{}, err
	}
	if promptContainsImage(request) && !connection.profile.Operations.PromptImage {
		return acp.PromptResponse{}, unsupportedAgentCapability("image prompts")
	}
	return connection.client.Prompt(ctx, request)
}

func hasAgentCapability(profile AgentProfile, method string) bool {
	for _, missing := range profile.MissingRequired {
		if missing == method {
			return false
		}
	}
	return true
}

func promptContainsImage(request acp.PromptRequest) bool {
	for _, block := range request.Prompt {
		if block.Image != nil {
			return true
		}
	}
	return false
}

func unsupportedAgentCapability(capability string) error {
	return &codedError{code: "UNSUPPORTED_AGENT_CAPABILITY", message: "Connected agent does not support " + capability}
}

func (c *GooseClient) Cancel(ctx context.Context, sessionID string) error {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return err
	}
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return connection.client.Cancel(bounded, acp.CancelNotification{SessionId: acp.SessionId(sessionID)})
}

func (c *GooseClient) SetConfig(ctx context.Context, request acp.SetSessionConfigOptionRequest) (acp.SetSessionConfigOptionResponse, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return acp.SetSessionConfigOptionResponse{}, err
	}
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return connection.client.SetSessionConfigOption(bounded, request)
}

func (c *GooseClient) Close() {
	c.disconnect(true)
}

func (c *GooseClient) disconnect(shutdown bool) {
	c.mu.Lock()
	c.closed = c.closed || shutdown
	connection := c.connection
	c.connection = nil
	attempt := c.connecting
	c.connecting = nil
	if attempt != nil {
		attempt.err = fmt.Errorf("ACP connection was reset")
		if c.closed {
			attempt.err = fmt.Errorf("ACP client has been shut down")
		}
		close(attempt.done)
	}
	c.mu.Unlock()
	if attempt != nil {
		attempt.cancel()
	}
	if connection != nil {
		connection.close()
	}
}

func (c *GooseClient) drop(connection *gooseConnection) {
	c.mu.Lock()
	if c.connection == connection {
		c.connection = nil
	}
	c.mu.Unlock()
	connection.close()
}

func (c *gooseConnection) close() {
	c.cancel()
	_ = c.stream.Close()
}

func (c *GooseClient) bounded(ctx context.Context) (context.Context, context.CancelFunc) {
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = defaultGooseTimeout
	}
	return context.WithTimeout(ctx, timeout)
}

func isDone(connection *gooseConnection) bool {
	select {
	case <-connection.client.Done():
		return true
	default:
		return false
	}
}

func dialGoose(ctx context.Context, url, secret string, events GooseEvents, generation uint64) (*gooseConnection, error) {
	header := make(http.Header)
	if secret != "" {
		header.Set("X-Secret-Key", secret)
	}
	webSocket, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		return nil, err
	}
	connectionContext, cancel := context.WithCancel(context.Background())
	webSocket.SetReadLimit(gooseReadLimit)
	stream := &acpWebSocketStream{ctx: connectionContext, connection: webSocket}
	sink := &gooseSink{events: events, generation: generation}
	return &gooseConnection{client: acp.NewClientSideConnection(sink, stream, stream), stream: stream, cancel: cancel, sink: sink}, nil
}

type acpWebSocketStream struct {
	ctx        context.Context
	connection *websocket.Conn
	readBuffer []byte
	writeMu    sync.Mutex
}

func (s *acpWebSocketStream) Read(buffer []byte) (int, error) {
	for len(s.readBuffer) == 0 {
		messageType, payload, err := s.connection.Read(s.ctx)
		if err != nil {
			return 0, err
		}
		if messageType != websocket.MessageText {
			return 0, fmt.Errorf("ACP WebSocket received a non-text frame")
		}
		s.readBuffer = append(payload, '\n')
	}
	count := copy(buffer, s.readBuffer)
	s.readBuffer = s.readBuffer[count:]
	return count, nil
}

func (s *acpWebSocketStream) Write(payload []byte) (int, error) {
	frame := bytes.TrimSuffix(payload, []byte{'\n'})
	if len(frame) == 0 || bytes.Contains(frame, []byte{'\n'}) {
		return 0, fmt.Errorf("ACP SDK emitted an invalid line")
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if err := s.connection.Write(s.ctx, websocket.MessageText, frame); err != nil {
		return 0, err
	}
	return len(payload), nil
}

func (s *acpWebSocketStream) Close() error {
	s.connection.CloseNow()
	return nil
}

type gooseSink struct {
	events     GooseEvents
	generation uint64
	goose      atomic.Bool
}

func (s *gooseSink) HandleExtensionMethod(ctx context.Context, method string, params json.RawMessage) (any, error) {
	if strings.HasPrefix(method, "_goose/") && !s.goose.Load() {
		return nil, acp.NewMethodNotFound(method)
	}
	if s.events == nil {
		return nil, acp.NewMethodNotFound(method)
	}
	if err := s.events.Extension(context.WithValue(ctx, connectionGenerationKey{}, s.generation), method, params); err != nil {
		return nil, err
	}
	return nil, nil
}

func (s *gooseSink) SessionUpdate(ctx context.Context, params acp.SessionNotification) error {
	if s.events == nil {
		return nil
	}
	ctx = context.WithValue(ctx, connectionGenerationKey{}, s.generation)
	ctx = context.WithValue(ctx, recognizedGooseConnectionKey{}, s.goose.Load())
	return s.events.SessionUpdate(ctx, params)
}

func (s *gooseSink) RequestPermission(ctx context.Context, params acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	if s.events != nil {
		return s.events.Permission(context.WithValue(ctx, connectionGenerationKey{}, s.generation), params)
	}
	return acp.RequestPermissionResponse{Outcome: acp.NewRequestPermissionOutcomeCancelled()}, nil
}

var errUnsupportedACPClientMethod = errors.New("unsupported ACP client method")

func (s *gooseSink) ReadTextFile(context.Context, acp.ReadTextFileRequest) (acp.ReadTextFileResponse, error) {
	return acp.ReadTextFileResponse{}, errUnsupportedACPClientMethod
}
func (s *gooseSink) WriteTextFile(context.Context, acp.WriteTextFileRequest) (acp.WriteTextFileResponse, error) {
	return acp.WriteTextFileResponse{}, errUnsupportedACPClientMethod
}
func (s *gooseSink) CreateTerminal(context.Context, acp.CreateTerminalRequest) (acp.CreateTerminalResponse, error) {
	return acp.CreateTerminalResponse{}, errUnsupportedACPClientMethod
}
func (s *gooseSink) KillTerminal(context.Context, acp.KillTerminalRequest) (acp.KillTerminalResponse, error) {
	return acp.KillTerminalResponse{}, errUnsupportedACPClientMethod
}
func (s *gooseSink) TerminalOutput(context.Context, acp.TerminalOutputRequest) (acp.TerminalOutputResponse, error) {
	return acp.TerminalOutputResponse{}, errUnsupportedACPClientMethod
}
func (s *gooseSink) ReleaseTerminal(context.Context, acp.ReleaseTerminalRequest) (acp.ReleaseTerminalResponse, error) {
	return acp.ReleaseTerminalResponse{}, errUnsupportedACPClientMethod
}
func (s *gooseSink) WaitForTerminalExit(context.Context, acp.WaitForTerminalExitRequest) (acp.WaitForTerminalExitResponse, error) {
	return acp.WaitForTerminalExitResponse{}, errUnsupportedACPClientMethod
}

var _ io.ReadWriter = (*acpWebSocketStream)(nil)
