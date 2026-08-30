package controller

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

const gitPreviewMaxBytes = 1024 * 1024

var gitOIDPattern = regexp.MustCompile(`^[0-9a-f]{4,64}$`)

type GitDiffScope struct {
	Kind    string `json:"kind"`
	SHA     string `json:"sha,omitempty"`
	BaseRef string `json:"baseRef,omitempty"`
}

type GitDiffFile struct {
	Original    string `json:"original"`
	Modified    string `json:"modified"`
	Unavailable bool   `json:"unavailable,omitempty"`
	Binary      bool   `json:"binary,omitempty"`
	TooLarge    bool   `json:"tooLarge,omitempty"`
	Message     string `json:"message,omitempty"`
}

type GitCommit struct {
	SHA         string `json:"sha"`
	ShortSHA    string `json:"shortSha"`
	Subject     string `json:"subject"`
	Author      string `json:"author"`
	CommittedAt string `json:"committedAt"`
}

type diffRange struct {
	prefix      []string
	revisions   []string
	untracked   bool
	originalRef string
	modifiedRef string
}

func resolveCommit(ctx context.Context, repository, ref string) string {
	result := runGit(ctx, repository, []string{"rev-parse", "--verify", "--quiet", "--end-of-options", ref + "^{commit}"}, gitOutputLimit)
	if !result.ok {
		return ""
	}
	return strings.TrimSpace(result.out)
}

func resolveDiffRange(ctx context.Context, repository string, scope GitDiffScope) (diffRange, error) {
	if scope.Kind == "" || scope.Kind == "uncommitted" || scope.Kind == "branch" {
		if resolveCommit(ctx, repository, "HEAD") == "" {
			return diffRange{prefix: []string{"diff", "--cached"}, untracked: true}, nil
		}
		return diffRange{prefix: []string{"diff"}, revisions: []string{"HEAD"}, untracked: true, originalRef: "HEAD"}, nil
	}
	requested := scope.SHA
	if scope.Kind == "pinned" {
		requested = scope.BaseRef
	}
	if (scope.Kind != "commit" && scope.Kind != "pinned") || !gitOIDPattern.MatchString(requested) {
		return diffRange{}, fmt.Errorf("unsupported Git diff scope")
	}
	resolved := resolveCommit(ctx, repository, requested)
	if resolved == "" {
		return diffRange{}, &codedError{code: "UNKNOWN_COMMIT", message: "Unknown commit: " + requested}
	}
	if scope.Kind == "pinned" {
		return diffRange{prefix: []string{"diff"}, revisions: []string{resolved}, untracked: true, originalRef: resolved}, nil
	}
	parent := resolveCommit(ctx, repository, resolved+"^")
	if parent == "" {
		return diffRange{prefix: []string{"show", "--format="}, revisions: []string{resolved}, modifiedRef: resolved}, nil
	}
	return diffRange{prefix: []string{"diff"}, revisions: []string{parent, resolved}, originalRef: parent, modifiedRef: resolved}, nil
}

type codedError struct {
	code    string
	message string
}

func (e *codedError) Error() string { return e.message }

func changedArgs(value diffRange, mode string) []string {
	args := append([]string(nil), value.prefix...)
	args = append(args, "--no-ext-diff", "--no-textconv", mode, "-z", "--end-of-options")
	args = append(args, value.revisions...)
	return append(args, "--")
}

func (g *Git) changes(ctx context.Context, repository string) ([]GitFileChange, error) {
	rangeValue, err := resolveDiffRange(ctx, repository, GitDiffScope{Kind: "uncommitted"})
	if err != nil {
		return nil, err
	}
	countsResult := runGit(ctx, repository, changedArgs(rangeValue, "--numstat"), gitOutputLimit)
	tracked := runGit(ctx, repository, changedArgs(rangeValue, "--name-status"), gitOutputLimit)
	if !countsResult.ok || !tracked.ok {
		return nil, fmt.Errorf("could not read changed files")
	}
	counts := parseNumstat(countsResult.out)
	result := parseNameStatus(tracked.out, counts)
	if rangeValue.untracked {
		untracked := runGit(ctx, repository, []string{"ls-files", "-z", "--others", "--exclude-standard"}, gitOutputLimit)
		if !untracked.ok {
			return nil, fmt.Errorf("could not read untracked files: %s", untracked.err)
		}
		counted := 0
		for _, name := range strings.Split(untracked.out, "\x00") {
			if name == "" {
				continue
			}
			change := GitFileChange{Path: name, Status: "untracked"}
			absolute := filepath.Join(repository, filepath.FromSlash(name))
			if counted < 64 {
				if _, err := g.policy.Resolve(absolute, false, true, "Git status path"); err == nil {
					if preview := readWorktreePreview(absolute); preview.issue == "" {
						added, removed := lineCount(preview.content), 0
						change.Added, change.Removed = &added, &removed
					}
				}
			}
			counted++
			result = append(result, change)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Path < result[j].Path })
	return result, nil
}

func parseNumstat(output string) map[string][2]int {
	result := make(map[string][2]int)
	records := strings.Split(output, "\x00")
	for index := 0; index < len(records); index++ {
		parts := strings.Split(records[index], "\t")
		if len(parts) < 3 {
			continue
		}
		added, addErr := strconv.Atoi(parts[0])
		removed, removeErr := strconv.Atoi(parts[1])
		if addErr != nil || removeErr != nil {
			continue
		}
		name := strings.Join(parts[2:], "\t")
		if name == "" && index+2 < len(records) {
			index += 2
			name = records[index]
		}
		if name != "" {
			result[name] = [2]int{added, removed}
		}
	}
	return result
}

func parseNameStatus(output string, counts map[string][2]int) []GitFileChange {
	records := strings.Split(output, "\x00")
	result := []GitFileChange{}
	for index := 0; index < len(records); index++ {
		record := records[index]
		if record == "" {
			continue
		}
		separator := strings.IndexByte(record, '\t')
		code, name := record, ""
		if separator >= 0 {
			code, name = record[:separator], record[separator+1:]
		} else if index+1 < len(records) {
			index++
			name = records[index]
		}
		if (strings.HasPrefix(code, "R") || strings.HasPrefix(code, "C")) && index+1 < len(records) {
			index++
			name = records[index]
		}
		if name == "" {
			continue
		}
		status := "modified"
		switch code[0] {
		case 'A', 'C':
			status = "added"
		case 'D':
			status = "deleted"
		case 'R':
			status = "renamed"
		}
		change := GitFileChange{Path: name, Status: status}
		if value, ok := counts[name]; ok {
			added, removed := value[0], value[1]
			change.Added, change.Removed = &added, &removed
		}
		result = append(result, change)
	}
	return result
}

func (g *Git) DiffFile(ctx context.Context, projectID, repository, name string, scope GitDiffScope) (GitDiffFile, error) {
	_, admitted, err := g.repositoryFor(ctx, projectID, repository)
	if err != nil {
		return GitDiffFile{}, err
	}
	rangeValue, err := resolveDiffRange(ctx, admitted, scope)
	if err != nil {
		return GitDiffFile{}, err
	}
	absolute := name
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Join(admitted, filepath.FromSlash(name))
	}
	if !within(admitted, absolute) {
		return GitDiffFile{}, fmt.Errorf("path escapes the repository")
	}
	if _, err := g.policy.Resolve(absolute, false, true, "Git diff path"); err != nil {
		return GitDiffFile{}, err
	}
	original := filePreview{content: ""}
	if rangeValue.originalRef != "" {
		original = readBlobPreview(ctx, admitted, rangeValue.originalRef, name)
	}
	if original.issue != "" {
		return unavailableDiff(original), nil
	}
	modified := filePreview{}
	if rangeValue.modifiedRef != "" {
		modified = readBlobPreview(ctx, admitted, rangeValue.modifiedRef, name)
	} else {
		modified = readWorktreePreview(absolute)
	}
	if modified.issue == "missing" {
		return GitDiffFile{Original: original.content}, nil
	}
	if modified.issue != "" {
		return unavailableDiff(modified), nil
	}
	return GitDiffFile{Original: original.content, Modified: modified.content}, nil
}

func (g *Git) ListCommits(ctx context.Context, projectID, repository string) (map[string]any, error) {
	_, admitted, err := g.repositoryFor(ctx, projectID, repository)
	if err != nil {
		return nil, err
	}
	log := runGit(ctx, admitted, []string{"log", "--max-count=200", "--format=%H%x00%h%x00%cI%x00%an%x00%s", "--"}, gitOutputLimit)
	commits := []GitCommit{}
	if log.ok {
		for _, line := range strings.Split(strings.TrimSpace(log.out), "\n") {
			parts := strings.Split(line, "\x00")
			if len(parts) >= 5 && parts[0] != "" && parts[1] != "" {
				commits = append(commits, GitCommit{SHA: parts[0], ShortSHA: parts[1], CommittedAt: parts[2], Author: plainGitText(parts[3]), Subject: plainGitText(strings.Join(parts[4:], "\x00"))})
			}
		}
	}
	return map[string]any{"commits": commits}, nil
}

type filePreview struct {
	content string
	issue   string
}

func readWorktreePreview(name string) filePreview {
	file, err := os.Open(name)
	if os.IsNotExist(err) {
		return filePreview{issue: "missing"}
	}
	if err != nil {
		return filePreview{issue: "unavailable"}
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return filePreview{issue: "unavailable"}
	}
	if info.Size() > gitPreviewMaxBytes {
		return filePreview{issue: "tooLarge"}
	}
	content, err := io.ReadAll(io.LimitReader(file, gitPreviewMaxBytes+1))
	if err != nil {
		return filePreview{issue: "unavailable"}
	}
	if len(content) > gitPreviewMaxBytes {
		return filePreview{issue: "tooLarge"}
	}
	if bytes.IndexByte(content, 0) >= 0 {
		return filePreview{issue: "binary"}
	}
	return filePreview{content: string(content)}
}

func readBlobPreview(ctx context.Context, repository, ref, name string) filePreview {
	object := ref + ":" + name
	size := runGit(ctx, repository, []string{"cat-file", "-s", "--end-of-options", object}, gitOutputLimit)
	if !size.ok {
		return filePreview{content: ""}
	}
	bytesCount, err := strconv.Atoi(strings.TrimSpace(size.out))
	if err != nil || bytesCount < 0 {
		return filePreview{issue: "unavailable"}
	}
	if bytesCount > gitPreviewMaxBytes {
		return filePreview{issue: "tooLarge"}
	}
	shown := runGit(ctx, repository, []string{"show", "--no-ext-diff", "--no-textconv", "--end-of-options", object}, gitPreviewMaxBytes)
	if shown.failure == "output-limit" {
		return filePreview{issue: "tooLarge"}
	}
	if !shown.ok {
		return filePreview{content: ""}
	}
	if strings.IndexByte(shown.out, 0) >= 0 {
		return filePreview{issue: "binary"}
	}
	return filePreview{content: shown.out}
}

func unavailableDiff(preview filePreview) GitDiffFile {
	result := GitDiffFile{Unavailable: true}
	switch preview.issue {
	case "binary":
		result.Binary, result.Message = true, "Binary files cannot be previewed"
	case "tooLarge":
		result.TooLarge, result.Message = true, "File is too large to preview"
	case "missing":
		result.Message = "File does not exist"
	default:
		result.Message = "File is unavailable for preview"
	}
	return result
}

func lineCount(content string) int {
	if content == "" {
		return 0
	}
	count := strings.Count(content, "\n")
	if !strings.HasSuffix(content, "\n") {
		count++
	}
	return count
}

func plainGitText(value string) string {
	return strings.Map(func(character rune) rune {
		if unicode.IsControl(character) || character >= '\u200b' && character <= '\u200f' || character >= '\u202a' && character <= '\u202e' || character >= '\u2066' && character <= '\u2069' || character == '\u061c' || character == '\ufeff' || character == '\u00ad' {
			return -1
		}
		return character
	}, value)
}
