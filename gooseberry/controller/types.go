package controller

type AgentOperations struct {
	DeleteSession  bool `json:"deleteSession"`
	ForkSession    bool `json:"forkSession"`
	PromptImage    bool `json:"promptImage"`
	HTTPMCP        bool `json:"httpMcp"`
	Steer          bool `json:"steer"`
	RenameSession  bool `json:"renameSession"`
	ArchiveSession bool `json:"archiveSession"`
	Administration bool `json:"administration"`
}

type AgentProfile struct {
	Name            string          `json:"name"`
	Version         string          `json:"version"`
	Goose           bool            `json:"goose"`
	Compatible      bool            `json:"compatible"`
	MissingRequired []string        `json:"missingRequired"`
	Operations      AgentOperations `json:"operations"`
	identity        string
}

type Project struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Roots      []string `json:"roots"`
	Slug       string   `json:"slug"`
	LastOpened float64  `json:"lastOpened"`
	Icon       string   `json:"icon,omitempty"`
	Closed     bool     `json:"closed,omitempty"`
}

type FileNode struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type FileListing struct {
	Nodes    []FileNode `json:"nodes"`
	Complete bool       `json:"complete"`
	Warnings []string   `json:"warnings"`
}

type DirectoryEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type DirectoryListing struct {
	Path        *string          `json:"path"`
	Roots       []string         `json:"roots"`
	Directories []DirectoryEntry `json:"directories"`
	Page        int              `json:"page"`
	PageSize    int              `json:"pageSize"`
	HasMore     bool             `json:"hasMore"`
	Complete    bool             `json:"complete"`
	Warnings    []string         `json:"warnings"`
	Cursor      *string          `json:"cursor"`
}

type WireModel struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Provider       string   `json:"provider"`
	ContextWindow  *int     `json:"contextWindow,omitempty"`
	MaxTokens      *int     `json:"maxTokens,omitempty"`
	Reasoning      *bool    `json:"reasoning,omitempty"`
	ThinkingLevels []string `json:"thinkingLevels,omitempty"`
	Input          []string `json:"input,omitempty"`
	Cost           any      `json:"cost,omitempty"`
	Available      bool     `json:"available"`
	Hidden         bool     `json:"hidden"`
}

type SessionSettlement struct {
	StopReason   string `json:"stopReason"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

type SessionQueue struct {
	Revision string      `json:"revision"`
	Steering []string    `json:"steering"`
	FollowUp []string    `json:"followUp"`
	Blocked  *QueueBlock `json:"blocked,omitempty"`
}

type QueueBlock struct {
	Lane   string `json:"lane"`
	Index  int    `json:"index"`
	Reason string `json:"reason"`
}

type SessionSummary struct {
	SessionID       string             `json:"sessionId"`
	ProjectID       string             `json:"projectId"`
	CWD             string             `json:"cwd"`
	ParentSessionID string             `json:"parentSessionId,omitempty"`
	Title           string             `json:"title"`
	Model           *WireModel         `json:"model"`
	ThinkingLevel   string             `json:"thinkingLevel"`
	IsStreaming     bool               `json:"isStreaming"`
	MessageCount    int                `json:"messageCount"`
	UpdatedAt       int64              `json:"updatedAt"`
	Live            bool               `json:"live"`
	Archived        bool               `json:"archived"`
	LastSettlement  *SessionSettlement `json:"lastSettlement,omitempty"`
	Queue           *SessionQueue      `json:"queue,omitempty"`
}

type SessionStats struct {
	SessionID     string          `json:"sessionId"`
	TotalMessages int             `json:"totalMessages"`
	Tokens        SessionTokens   `json:"tokens"`
	Cost          float64         `json:"cost"`
	CostCurrency  string          `json:"costCurrency,omitempty"`
	Reported      map[string]bool `json:"reported,omitempty"`
	ContextUsage  map[string]any  `json:"contextUsage,omitempty"`
}

type SessionTokens struct {
	Input      int64 `json:"input"`
	Output     int64 `json:"output"`
	CacheRead  int64 `json:"cacheRead"`
	CacheWrite int64 `json:"cacheWrite"`
	Total      int64 `json:"total"`
}
