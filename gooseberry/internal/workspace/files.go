package workspace

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	"github.com/miloszkolber/gooseberry/internal/persist"
)

const (
	fileListLimit  = 2_000
	fileReadLimit  = 4 * 1024 * 1024
	directoryLimit = 10_000
	directoryBatch = 128
	pageLimit      = 99
	defaultPage    = 100
)

type Files struct {
	projects *Projects
	policy   *PathPolicy
}

func NewFiles(projects *Projects, policy *PathPolicy) *Files {
	return &Files{projects: projects, policy: policy}
}

func (f *Files) ReadDir(projectID, path string) (FileListing, error) {
	root, absolute, err := f.resolve(projectID, path)
	if err != nil {
		return FileListing{}, err
	}
	directory, err := os.Open(absolute)
	if err != nil {
		return FileListing{}, err
	}
	defer directory.Close()
	// One overflow entry and the excluded .git entry are sufficient to decide
	// completeness without materializing the entire directory.
	entries, err := directory.ReadDir(fileListLimit + 2)
	if err != nil && !errors.Is(err, io.EOF) {
		return FileListing{}, err
	}
	visible := entries[:0]
	for _, entry := range entries {
		if entry.Name() != ".git" {
			visible = append(visible, entry)
		}
	}
	entries = visible
	complete := len(entries) <= fileListLimit
	if len(entries) > fileListLimit {
		entries = entries[:fileListLimit]
	}
	nodes := make([]FileNode, 0, len(entries))
	for _, entry := range entries {
		candidate := filepath.Join(absolute, entry.Name())
		if _, err := f.policy.Resolve(candidate, false, false, "Project file"); err != nil {
			continue
		}
		kind := "file"
		if entry.IsDir() {
			kind = "dir"
		}
		relative, err := filepath.Rel(root, candidate)
		if err != nil {
			continue
		}
		nodes = append(nodes, FileNode{Path: relative, Name: entry.Name(), Kind: kind})
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].Kind != nodes[j].Kind {
			return nodes[i].Kind == "dir"
		}
		return nodes[i].Name < nodes[j].Name
	})
	warnings := []string{}
	if !complete {
		warnings = append(warnings, "File list reached its 2,000-entry safety limit.")
	}
	return FileListing{Nodes: nodes, Complete: complete, Warnings: warnings}, nil
}

func (f *Files) ReadFile(projectID, path string) (string, error) {
	_, absolute, err := f.resolve(projectID, path)
	if err != nil {
		return "", err
	}
	content, _, err := persist.ReadBoundedFile(absolute, fileReadLimit)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func (f *Files) resolve(projectID, path string) (string, string, error) {
	root, err := f.projects.Root(projectID)
	if err != nil {
		return "", "", err
	}
	return f.ResolveInRoot(root, path)
}

// root must come from a freshly authorized project snapshot.
func (f *Files) ResolveInRoot(root, path string) (string, string, error) {
	candidate := filepath.Clean(path)
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(root, candidate)
	}
	if !Within(root, candidate) {
		return "", "", fmt.Errorf("path escapes the project root")
	}
	absolute, err := f.policy.Resolve(candidate, false, false, "Project file")
	if err != nil {
		return "", "", err
	}
	if !Within(root, absolute) {
		return "", "", fmt.Errorf("path escapes the project root")
	}
	return root, absolute, nil
}

type DirectoryRequest struct {
	Path          *string
	Page          int
	PageSize      int
	IncludeHidden bool
}

func (f *Files) ListDirectories(request DirectoryRequest) (DirectoryListing, error) {
	pageSize := request.PageSize
	if pageSize == 0 {
		pageSize = defaultPage
	}
	if request.Page < 0 || request.Page > pageLimit || pageSize < 1 || pageSize > defaultPage {
		return DirectoryListing{}, fmt.Errorf("invalid directory browser pagination")
	}
	roots := f.policy.Roots()
	if request.Path == nil {
		start := request.Page * pageSize
		if start > len(roots) {
			start = len(roots)
		}
		end := min(start+pageSize, len(roots))
		entries := make([]DirectoryEntry, 0, end-start)
		for _, root := range roots[start:end] {
			name := filepath.Base(root)
			if name == "." || name == string(filepath.Separator) {
				name = root
			}
			entries = append(entries, DirectoryEntry{Name: name, Path: root})
		}
		hasMore := request.Page < pageLimit && end < len(roots)
		return DirectoryListing{Roots: roots, Directories: entries, Page: request.Page, PageSize: pageSize, HasMore: hasMore, Complete: end >= len(roots), Warnings: []string{}, Cursor: nextCursor(request.Page, hasMore)}, nil
	}
	if *request.Path == "" || containsNUL(*request.Path) {
		return DirectoryListing{}, fmt.Errorf("invalid directory browser path")
	}
	current, err := f.policy.Directory(*request.Path, "Directory")
	if err != nil {
		return DirectoryListing{}, err
	}
	directory, err := os.Open(current)
	if err != nil {
		return DirectoryListing{}, err
	}
	defer directory.Close()
	offset := request.Page * pageSize
	matched, scanned := 0, 0
	entries := make([]DirectoryEntry, 0, pageSize)
	hasMore := false
scan:
	for scanned < directoryLimit {
		batch, readErr := directory.ReadDir(min(directoryBatch, directoryLimit-scanned))
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return DirectoryListing{}, readErr
		}
		if len(batch) == 0 {
			break
		}
		for _, entry := range batch {
			scanned++
			if !request.IncludeHidden && len(entry.Name()) > 0 && entry.Name()[0] == '.' {
				continue
			}
			candidate, resolveErr := f.policy.Directory(filepath.Join(current, entry.Name()), "Directory")
			if resolveErr != nil {
				continue
			}
			if matched < offset {
				matched++
				continue
			}
			if len(entries) == pageSize {
				hasMore = request.Page < pageLimit
				break scan
			}
			entries = append(entries, DirectoryEntry{Name: entry.Name(), Path: candidate})
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
	}
	scanLimited := scanned == directoryLimit
	warnings := []string{}
	if scanLimited {
		warnings = append(warnings, "Directory scan reached its 10,000-entry safety limit.")
	}
	path := current
	return DirectoryListing{Path: &path, Roots: roots, Directories: entries, Page: request.Page, PageSize: pageSize, HasMore: hasMore, Complete: !hasMore && !scanLimited, Warnings: warnings, Cursor: nextCursor(request.Page, hasMore)}, nil
}

func nextCursor(page int, more bool) *string {
	if !more {
		return nil
	}
	value := fmt.Sprintf("%d", page+1)
	return &value
}

func containsNUL(value string) bool {
	for _, character := range value {
		if character == 0 {
			return true
		}
	}
	return false
}
