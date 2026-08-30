package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/coder/websocket"
)

const (
	defaultGooseURL     = "ws://127.0.0.1:3284/acp"
	defaultGooseTimeout = 30 * time.Second
	gooseReadLimit      = 10 * 1024 * 1024
)

type GooseEvents interface {
	SessionUpdate(context.Context, acp.SessionNotification) error
	Extension(context.Context, string, json.RawMessage) error
	Permission(context.Context, acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error)
}

type GooseClient struct {
	URL       string
	SecretKey string
	Version   string
	Timeout   time.Duration
	Events    GooseEvents

	mu         sync.Mutex
	connection *gooseConnection
	closed     bool
	generation uint64
}

type gooseConnection struct {
	client *acp.ClientSideConnection
	stream *acpWebSocketStream
	cancel context.CancelFunc
}

func NewGooseClient(url, secret, version string, events GooseEvents) *GooseClient {
	if url == "" {
		url = defaultGooseURL
	}
	return &GooseClient{URL: url, SecretKey: secret, Version: version, Timeout: defaultGooseTimeout, Events: events}
}

func (c *GooseClient) Ready(ctx context.Context) (uint64, error) {
	connection, generation, err := c.ready(ctx)
	if err != nil {
		return 0, err
	}
	select {
	case <-connection.client.Done():
		c.drop(connection)
		return 0, fmt.Errorf("Goose ACP connection closed")
	default:
		return generation, nil
	}
}

func (c *GooseClient) ready(ctx context.Context) (*gooseConnection, uint64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, 0, fmt.Errorf("Goose client has been shut down")
	}
	if expected, attached := ctx.Value(connectionGenerationKey{}).(uint64); attached {
		if expected == 0 || c.connection == nil || c.generation != expected || isDone(c.connection) {
			return nil, 0, fmt.Errorf("Goose ACP connection changed; reload the chat before retrying")
		}
	}
	if c.connection != nil {
		select {
		case <-c.connection.client.Done():
			c.connection.cancel()
			c.connection.stream.Close()
			c.connection = nil
		default:
			return c.connection, c.generation, nil
		}
	}
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	connection, err := dialGoose(bounded, c.URL, c.SecretKey, c.Events, c.generation+1)
	if err != nil {
		return nil, 0, err
	}
	version := c.Version
	if version == "" {
		version = "0.0.0"
	}
	_, err = connection.client.Initialize(bounded, acp.InitializeRequest{
		ProtocolVersion: acp.ProtocolVersion(acp.ProtocolVersionNumber),
		ClientInfo:      &acp.Implementation{Name: "gooseberry", Version: version},
		ClientCapabilities: acp.ClientCapabilities{
			Meta: map[string]any{"goose": map[string]any{"customNotifications": true}},
		},
	})
	if err != nil {
		connection.cancel()
		connection.stream.Close()
		return nil, 0, fmt.Errorf("initialize Goose ACP: %w", err)
	}
	c.generation++
	c.connection = connection
	return connection, c.generation, nil
}

func (c *GooseClient) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return c.CallUntilDone(bounded, method, params)
}

func (c *GooseClient) CallUntilDone(ctx context.Context, method string, params any) (json.RawMessage, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return nil, err
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
	c.mu.Lock()
	connection := c.connection
	c.connection = nil
	c.mu.Unlock()
	if connection != nil {
		connection.cancel()
		_ = connection.stream.Close()
	}
}

func (c *GooseClient) ListSessions(ctx context.Context, request acp.ListSessionsRequest) (acp.ListSessionsResponse, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return acp.ListSessionsResponse{}, err
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
	bounded, cancel := c.bounded(ctx)
	defer cancel()
	return connection.client.LoadSession(bounded, request)
}

func (c *GooseClient) ForkSession(ctx context.Context, request acp.UnstableForkSessionRequest) (acp.UnstableForkSessionResponse, error) {
	connection, _, err := c.ready(ctx)
	if err != nil {
		return acp.UnstableForkSessionResponse{}, err
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
	return connection.client.Prompt(ctx, request)
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
	c.mu.Lock()
	c.closed = true
	connection := c.connection
	c.connection = nil
	c.mu.Unlock()
	if connection != nil {
		connection.cancel()
		connection.stream.Close()
	}
}

func (c *GooseClient) drop(connection *gooseConnection) {
	c.mu.Lock()
	if c.connection == connection {
		c.connection = nil
	}
	c.mu.Unlock()
	connection.cancel()
	connection.stream.Close()
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
	return &gooseConnection{client: acp.NewClientSideConnection(sink, stream, stream), stream: stream, cancel: cancel}, nil
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
}

func (s *gooseSink) HandleExtensionMethod(ctx context.Context, method string, params json.RawMessage) (any, error) {
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
	return s.events.SessionUpdate(context.WithValue(ctx, connectionGenerationKey{}, s.generation), params)
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
