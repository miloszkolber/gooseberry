package controller

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	maxAuthBodyBytes     = 4_096
	projectImageMaxBytes = 16 * 1024 * 1024
)

type HTTPHandler struct {
	WebSocket     *WebSocketServer
	Objective     ObjectiveHandler
	Projects      *Projects
	Files         *Files
	Auth          AuthConfig
	auth          *Auth
	StaticDir     string
	Ready         http.HandlerFunc
	browserClient *http.Client
}

func NewHTTPHandler(webSocket *WebSocketServer, objective ObjectiveHandler, projects *Projects, files *Files, authConfig AuthConfig, staticDir string, ready http.HandlerFunc) (*HTTPHandler, error) {
	result := &HTTPHandler{WebSocket: webSocket, Objective: objective, Projects: projects, Files: files, Auth: authConfig, StaticDir: staticDir, Ready: ready, browserClient: &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	if authConfig.Enabled {
		auth, err := NewAuth(authConfig.ControllerToken)
		if err != nil {
			return nil, err
		}
		result.auth = auth
	}
	return result, nil
}

func (h *HTTPHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	switch {
	case request.URL.Path == "/mcp/objective":
		h.Objective.ServeHTTP(response, request)
	case strings.HasPrefix(request.URL.Path, "/auth/"):
		h.serveAuth(response, request)
	case request.URL.Path == "/ws":
		h.WebSocket.ServeHTTP(response, request)
	case request.URL.Path == "/health" || request.URL.Path == "/livez":
		serveHealth(response, request)
	case request.URL.Path == "/readyz":
		if request.Method != http.MethodGet {
			methodNotAllowed(response, http.MethodGet)
		} else if h.Ready == nil {
			http.Error(response, "not ready", http.StatusServiceUnavailable)
		} else {
			h.Ready(response, request)
		}
	case strings.HasPrefix(request.URL.Path, "/files/"):
		h.serveProjectImage(response, request)
	case strings.HasPrefix(request.URL.Path, "/v1/artifacts/"):
		h.serveBrowserArtifact(response, request)
	default:
		h.serveStatic(response, request)
	}
}

func (h *HTTPHandler) serveAuth(response http.ResponseWriter, request *http.Request) {
	if request.URL.Path == "/auth/status" {
		if request.Method != http.MethodGet {
			methodNotAllowed(response, http.MethodGet)
			return
		}
		authenticated := true
		if h.Auth.Enabled {
			_, authenticated = h.auth.SessionExpiresAt(ReadAuthCookie(request))
		}
		writeAuthJSON(response, http.StatusOK, map[string]bool{"authenticationEnabled": h.Auth.Enabled, "authenticated": authenticated})
		return
	}
	if request.URL.Path != "/auth/login" && request.URL.Path != "/auth/logout" || !h.Auth.Enabled {
		writeAuthJSON(response, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		writeAuthJSON(response, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if request.Header.Get("Sec-Fetch-Site") != "same-origin" || !h.Auth.IsExpectedOrigin(request) {
		writeAuthJSON(response, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	body, status, err := readAuthBody(request)
	if err != nil {
		writeAuthJSON(response, status, map[string]string{"error": err.Error()})
		return
	}
	secure := request.TLS != nil || strings.HasPrefix(h.Auth.PublicOrigin, "https://")
	if request.URL.Path == "/auth/login" {
		if len(body) != 1 {
			writeAuthJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		token, ok := body["token"].(string)
		if !ok {
			writeAuthJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		session, ok := h.auth.Login(token)
		if !ok {
			writeAuthJSON(response, http.StatusUnauthorized, map[string]string{"error": "authentication failed"})
			return
		}
		response.Header().Set("Set-Cookie", SessionCookie(session, secure))
		writeAuthJSON(response, http.StatusOK, map[string]bool{"authenticated": true})
		return
	}
	if len(body) != 0 {
		writeAuthJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	response.Header().Set("Set-Cookie", ExpiredSessionCookie(secure))
	writeAuthJSON(response, http.StatusOK, map[string]bool{"authenticated": false})
}

func readAuthBody(request *http.Request) (map[string]any, int, error) {
	if request.Header.Get("Content-Type") != "application/json" {
		return nil, http.StatusUnsupportedMediaType, plainError("unsupported media type")
	}
	if request.ContentLength > maxAuthBodyBytes {
		return nil, http.StatusRequestEntityTooLarge, plainError("request too large")
	}
	reader := io.LimitReader(request.Body, maxAuthBodyBytes+1)
	content, err := io.ReadAll(reader)
	if err != nil || len(content) > maxAuthBodyBytes {
		return nil, http.StatusRequestEntityTooLarge, plainError("request too large")
	}
	var value map[string]any
	if json.Unmarshal(content, &value) != nil || value == nil {
		return nil, http.StatusBadRequest, plainError("invalid request")
	}
	return value, 0, nil
}

type plainError string

func (e plainError) Error() string { return string(e) }

func writeAuthJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func serveHealth(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		methodNotAllowed(response, http.MethodGet)
		return
	}
	_, _ = io.WriteString(response, "ok")
}

func methodNotAllowed(response http.ResponseWriter, method string) {
	response.Header().Set("Allow", method)
	http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
}

func (h *HTTPHandler) serveProjectImage(response http.ResponseWriter, request *http.Request) {
	if !h.Auth.IsAuthorizedHTTPRequest(request, h.auth) {
		http.Error(response, "unauthorized", http.StatusUnauthorized)
		return
	}
	if request.Method != http.MethodGet {
		methodNotAllowed(response, http.MethodGet)
		return
	}
	if len(request.URL.EscapedPath()) > 4_096 {
		http.NotFound(response, request)
		return
	}
	parts := strings.Split(strings.TrimPrefix(request.URL.EscapedPath(), "/files/"), "/")
	if len(parts) < 3 {
		http.NotFound(response, request)
		return
	}
	projectID, firstErr := url.PathUnescape(parts[0])
	rootIndex, secondErr := strconv.Atoi(parts[1])
	relative, thirdErr := url.PathUnescape(strings.Join(parts[2:], "/"))
	if firstErr != nil || secondErr != nil || thirdErr != nil || rootIndex < 0 {
		http.NotFound(response, request)
		return
	}
	project, err := h.Projects.Get(projectID)
	if err != nil || rootIndex >= len(project.Roots) {
		http.NotFound(response, request)
		return
	}
	_, file, err := h.Files.resolveInRoot(project.Roots[rootIndex], relative)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	opened, info, err := openRegularFile(file, projectImageMaxBytes)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	defer opened.Close()
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(mime.TypeByExtension(filepath.Ext(file)), ";")[0]))
	if contentType != "image/gif" && contentType != "image/jpeg" && contentType != "image/png" && contentType != "image/webp" {
		http.NotFound(response, request)
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	response.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(response, request, filepath.Base(file), info.ModTime(), io.NewSectionReader(opened, 0, info.Size()))
}

func (h *HTTPHandler) serveStatic(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		methodNotAllowed(response, http.MethodGet)
		return
	}
	requested := strings.TrimPrefix(path.Clean("/"+request.URL.Path), "/")
	if requested == "" || requested == "." {
		requested = "index.html"
	}
	file := filepath.Join(h.StaticDir, filepath.FromSlash(requested))
	if !within(h.StaticDir, file) || !regularFile(file) {
		file = filepath.Join(h.StaticDir, "index.html")
	}
	if !regularFile(file) {
		http.NotFound(response, request)
		return
	}
	http.ServeFile(response, request, file)
}

func regularFile(file string) bool {
	info, err := os.Stat(file)
	return err == nil && info.Mode().IsRegular()
}
