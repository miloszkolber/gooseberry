package workspace

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
