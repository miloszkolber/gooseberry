package controller

import (
	"context"
	"encoding/json"
	"fmt"
)

type Handler interface {
	Handle(context.Context, string, json.RawMessage, string) (any, error)
}

type CoreHandler struct {
	Projects *Projects
	Files    *Files
	Sessions *SessionManager
	Apps     *AppViews
	Settings *Settings
	Admin    *GooseAdmin
	Git      *Git
	Watches  *ProjectWatches
}

func (h CoreHandler) Handle(ctx context.Context, method string, raw json.RawMessage, clientKey string) (any, error) {
	switch method {
	case "history.search":
		var request map[string]any
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed history search")
		}
		return h.Sessions.history.Search(ctx, request)
	case "project.open":
		var request struct {
			Path string `json:"path"`
		}
		if err := decodeParams(raw, &request); err != nil || request.Path == "" {
			return nil, fmt.Errorf("malformed project request")
		}
		return h.Projects.Open(request.Path)
	case "project.addRoot":
		var request struct {
			ID   string `json:"id"`
			Path string `json:"path"`
		}
		if err := decodeParams(raw, &request); err != nil || request.ID == "" || request.Path == "" {
			return nil, fmt.Errorf("malformed project request")
		}
		project, err := h.Projects.AddRoot(request.ID, request.Path)
		if err == nil && h.Git != nil {
			h.Git.Invalidate(request.ID)
		}
		if err == nil && h.Watches != nil {
			err = h.Watches.Reconcile(request.ID)
		}
		return project, err
	case "project.removeRoot":
		var request struct {
			ID   string `json:"id"`
			Path string `json:"path"`
		}
		if err := decodeParams(raw, &request); err != nil || request.ID == "" || request.Path == "" {
			return nil, fmt.Errorf("malformed project request")
		}
		if h.Sessions != nil {
			root, err := h.Projects.AssertRoot(request.ID, request.Path)
			if err != nil {
				return nil, err
			}
			records, err := h.Sessions.records.List()
			if err != nil {
				return nil, err
			}
			for _, record := range records {
				if record.ProjectID == request.ID && within(root, record.CWD) {
					return nil, fmt.Errorf("move or delete sessions using this root before removing it")
				}
			}
		}
		project, err := h.Projects.RemoveRoot(request.ID, request.Path)
		if err == nil && h.Git != nil {
			h.Git.Invalidate(request.ID)
		}
		if err == nil && h.Watches != nil {
			err = h.Watches.Reconcile(request.ID)
		}
		return project, err
	case "project.update":
		var request struct {
			ID   string  `json:"id"`
			Name *string `json:"name"`
			Icon *string `json:"icon"`
		}
		if err := decodeParams(raw, &request); err != nil || request.ID == "" {
			return nil, fmt.Errorf("malformed project update")
		}
		return h.Projects.Update(request.ID, request.Name, request.Icon)
	case "project.list":
		return h.Projects.List(false)
	case "project.close":
		var request struct {
			ID string `json:"id"`
		}
		if err := decodeParams(raw, &request); err != nil || request.ID == "" {
			return nil, fmt.Errorf("malformed project request")
		}
		if h.Watches != nil {
			h.Watches.Stop(request.ID)
		}
		if _, err := h.Projects.Close(request.ID); err != nil {
			return nil, err
		}
		if h.Sessions != nil {
			h.Sessions.ReleaseProject(request.ID)
		}
		return map[string]bool{"ok": true}, nil
	case "project.watchReady":
		var request struct {
			ProjectID string `json:"projectId"`
		}
		if h.Watches == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed project watch request")
		}
		started, err := h.Watches.Ensure(request.ProjectID)
		if err != nil {
			return nil, err
		}
		return map[string]bool{"startupNudge": started}, nil
	case "directory.list":
		var request struct {
			Path          *string `json:"path"`
			Page          *int    `json:"page"`
			PageSize      *int    `json:"pageSize"`
			IncludeHidden *bool   `json:"includeHidden"`
		}
		if err := decodeParams(raw, &request); err != nil {
			return nil, fmt.Errorf("invalid directory browser request")
		}
		page, pageSize, hidden := 0, defaultPage, false
		if request.Page != nil {
			page = *request.Page
		}
		if request.PageSize != nil {
			pageSize = *request.PageSize
		}
		if request.IncludeHidden != nil {
			hidden = *request.IncludeHidden
		}
		return h.Files.ListDirectories(DirectoryRequest{Path: request.Path, Page: page, PageSize: pageSize, IncludeHidden: hidden})
	case "fs.readDir":
		var request fileRequest
		if err := decodeParams(raw, &request); err != nil || !request.valid() {
			return nil, fmt.Errorf("malformed file request")
		}
		if err := h.ensureWatch(request.ProjectID); err != nil {
			return nil, err
		}
		return h.Files.ReadDir(request.ProjectID, request.Root, request.Path)
	case "fs.readFile":
		var request fileRequest
		if err := decodeParams(raw, &request); err != nil || !request.valid() {
			return nil, fmt.Errorf("malformed file request")
		}
		if err := h.ensureWatch(request.ProjectID); err != nil {
			return nil, err
		}
		content, err := h.Files.ReadFile(request.ProjectID, request.Root, request.Path)
		if err != nil {
			return nil, err
		}
		return map[string]string{"content": content}, nil
	case "git.listRepositories":
		var request struct {
			ProjectID string `json:"projectId"`
		}
		if h.Git == nil || decodeParams(raw, &request) != nil || request.ProjectID == "" {
			return nil, fmt.Errorf("malformed Git request")
		}
		return h.Git.ListRepositories(ctx, request.ProjectID)
	case "git.status":
		var request struct {
			ProjectID  string       `json:"projectId"`
			Repository string       `json:"repository"`
			Scope      GitDiffScope `json:"scope"`
		}
		if h.Git == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed Git request")
		}
		if err := h.ensureWatch(request.ProjectID); err != nil {
			return nil, err
		}
		return h.Git.Status(ctx, request.ProjectID, request.Repository, request.Scope)
	case "git.diffFile":
		var request struct {
			ProjectID  string       `json:"projectId"`
			Repository string       `json:"repository"`
			Path       string       `json:"path"`
			Scope      GitDiffScope `json:"scope"`
		}
		if h.Git == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed Git request")
		}
		return h.Git.DiffFile(ctx, request.ProjectID, request.Repository, request.Path, request.Scope)
	case "git.listCommits":
		var request struct {
			ProjectID  string `json:"projectId"`
			Repository string `json:"repository"`
		}
		if h.Git == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed Git request")
		}
		return h.Git.ListCommits(ctx, request.ProjectID, request.Repository)
	case "git.listBranches":
		var request struct {
			ProjectID  string `json:"projectId"`
			Repository string `json:"repository"`
		}
		if h.Git == nil || decodeParams(raw, &request) != nil || request.ProjectID == "" || request.Repository == "" {
			return nil, fmt.Errorf("malformed Git request")
		}
		return h.Git.ListBranches(ctx, request.ProjectID, request.Repository)
	case "session.create":
		var request struct {
			ProjectID     string     `json:"projectId"`
			CWD           string     `json:"cwd"`
			Model         *WireModel `json:"model"`
			ThinkingLevel string     `json:"thinkingLevel"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil || request.ProjectID == "" {
			return nil, fmt.Errorf("malformed session request")
		}
		return h.Sessions.Create(ctx, request.ProjectID, request.CWD, request.Model, request.ThinkingLevel, clientKey)
	case "session.fork":
		var request sessionOwnerRequest
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		cwd, err := h.Sessions.RecordedCWD(request.ProjectID, request.SessionID)
		if err != nil {
			return nil, err
		}
		return h.Sessions.Fork(ctx, request.ProjectID, request.SessionID, cwd)
	case "session.prompt", "session.steer", "session.queueAdd":
		var request struct {
			SessionID string         `json:"sessionId"`
			Text      *string        `json:"text"`
			Images    []ImageContent `json:"images"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil || request.SessionID == "" || request.Text == nil {
			return nil, fmt.Errorf("malformed session request")
		}
		var err error
		switch method {
		case "session.prompt":
			err = h.Sessions.Prompt(ctx, request.SessionID, *request.Text, request.Images)
		case "session.steer":
			err = h.Sessions.Steer(ctx, request.SessionID, *request.Text, request.Images)
		case "session.queueAdd":
			if len(request.Images) > 0 {
				return nil, fmt.Errorf("queued messages do not support images")
			}
			err = h.Sessions.Queue(ctx, request.SessionID, *request.Text)
		}
		return ack(err)
	case "session.queueEdit":
		var request struct {
			SessionID string `json:"sessionId"`
			Lane      string `json:"lane"`
			Index     *int   `json:"index"`
			Text      string `json:"text"`
			Revision  string `json:"revision"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil || request.Index == nil {
			return nil, fmt.Errorf("malformed session request")
		}
		return ack(h.Sessions.EditQueue(request.SessionID, request.Lane, *request.Index, request.Text, request.Revision))
	case "session.queueRemove":
		var request struct {
			SessionID string `json:"sessionId"`
			Lane      string `json:"lane"`
			Index     *int   `json:"index"`
			Revision  string `json:"revision"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil || request.Index == nil {
			return nil, fmt.Errorf("malformed session request")
		}
		return ack(h.Sessions.RemoveQueue(request.SessionID, request.Lane, *request.Index, request.Revision))
	case "session.abort":
		var request struct {
			SessionID string `json:"sessionId"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		return ack(h.Sessions.Abort(ctx, request.SessionID))
	case "session.permissionReply":
		var request struct {
			SessionID    string `json:"sessionId"`
			PermissionID string `json:"permissionId"`
			OptionID     string `json:"optionId"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed permission request")
		}
		return ack(h.Sessions.ResolvePermission(request.SessionID, request.PermissionID, request.OptionID))
	case "session.list":
		var request struct {
			ProjectID string `json:"projectId"`
			Archived  any    `json:"archived"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil || request.ProjectID == "" {
			return nil, fmt.Errorf("malformed session request")
		}
		return h.Sessions.List(ctx, request.ProjectID, request.Archived)
	case "session.getMessages":
		var request sessionOwnerRequest
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		cwd, err := h.Sessions.RecordedCWD(request.ProjectID, request.SessionID)
		if err != nil {
			return nil, err
		}
		return h.Sessions.Messages(ctx, request.SessionID, request.ProjectID, cwd, clientKey)
	case "session.appResourceRead":
		var request struct {
			ProjectID   string `json:"projectId"`
			SessionID   string `json:"sessionId"`
			ToolCallID  string `json:"toolCallId"`
			ViewID      string `json:"viewId"`
			OperationID string `json:"operationId"`
			URI         string `json:"uri"`
		}
		if h.Apps == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed app resource request")
		}
		return h.Apps.ReadResource(ctx, request.ViewID, request.OperationID, request.ProjectID, request.SessionID, request.ToolCallID, request.URI, clientKey)
	case "session.appOpen":
		var request struct {
			ProjectID    string `json:"projectId"`
			SessionID    string `json:"sessionId"`
			ToolCallID   string `json:"toolCallId"`
			ParentOrigin string `json:"parentOrigin"`
		}
		if h.Apps == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed app open request")
		}
		return h.Apps.Open(ctx, request.ProjectID, request.SessionID, request.ToolCallID, request.ParentOrigin, clientKey)
	case "session.appContentRead":
		var request struct {
			ProjectID  string `json:"projectId"`
			SessionID  string `json:"sessionId"`
			ToolCallID string `json:"toolCallId"`
			ViewID     string `json:"viewId"`
			Offset     int    `json:"offset"`
		}
		if h.Apps == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed app content request")
		}
		return h.Apps.Content(request.ViewID, request.ProjectID, request.SessionID, request.ToolCallID, clientKey, request.Offset)
	case "session.appKeepAlive":
		var request struct {
			ProjectID  string `json:"projectId"`
			SessionID  string `json:"sessionId"`
			ToolCallID string `json:"toolCallId"`
			ViewID     string `json:"viewId"`
		}
		if h.Apps == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed app lease request")
		}
		return ack(h.Apps.KeepAlive(request.ViewID, request.ProjectID, request.SessionID, request.ToolCallID, clientKey))
	case "session.appClose":
		var request struct {
			ViewID string `json:"viewId"`
		}
		if h.Apps == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed app close request")
		}
		return ack(h.Apps.Close(ctx, request.ViewID, clientKey))
	case "session.appToolCall":
		var request struct {
			ProjectID   string         `json:"projectId"`
			SessionID   string         `json:"sessionId"`
			ToolCallID  string         `json:"toolCallId"`
			ViewID      string         `json:"viewId"`
			OperationID string         `json:"operationId"`
			Name        string         `json:"name"`
			Arguments   map[string]any `json:"arguments"`
		}
		if h.Apps == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed app tool request")
		}
		return h.Apps.CallTool(ctx, request.ViewID, request.OperationID, request.ProjectID, request.SessionID, request.ToolCallID, request.Name, request.Arguments, clientKey)
	case "session.appOperationCancel":
		var request struct {
			ViewID      string `json:"viewId"`
			OperationID string `json:"operationId"`
		}
		if h.Apps == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed app operation cancellation")
		}
		return ack(h.Apps.CancelOperation(request.ViewID, request.OperationID, clientKey))
	case "session.setLeases":
		var request struct {
			Revision uint64         `json:"revision"`
			Sessions []sessionLease `json:"sessions"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil || request.Sessions == nil {
			return nil, fmt.Errorf("malformed session lease snapshot")
		}
		return ack(h.Sessions.SetLeases(clientKey, request.Revision, request.Sessions))
	case "session.release":
		var request sessionOwnerRequest
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		cwd, err := h.Sessions.RecordedCWD(request.ProjectID, request.SessionID)
		if err != nil {
			return nil, err
		}
		h.Sessions.Release(request.SessionID, request.ProjectID, cwd, clientKey)
		return map[string]bool{"ok": true}, nil
	case "session.rename", "session.archive", "session.delete":
		var request struct {
			ProjectID string `json:"projectId"`
			SessionID string `json:"sessionId"`
			Title     string `json:"title"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		cwd, err := h.Sessions.RecordedCWD(request.ProjectID, request.SessionID)
		if err != nil {
			return nil, err
		}
		switch method {
		case "session.rename":
			err = h.Sessions.Rename(ctx, request.ProjectID, request.SessionID, cwd, request.Title)
		case "session.archive":
			err = h.Sessions.Archive(ctx, request.ProjectID, request.SessionID, cwd)
		case "session.delete":
			err = h.Sessions.Delete(ctx, request.ProjectID, request.SessionID, cwd)
		}
		return ack(err)
	case "session.unarchive":
		var request sessionOwnerRequest
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		return ack(h.Sessions.Unarchive(ctx, request.ProjectID, request.SessionID))
	case "session.setModel":
		var request struct {
			SessionID string    `json:"sessionId"`
			Model     WireModel `json:"model"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		return ack(h.Sessions.SetModel(ctx, request.SessionID, request.Model))
	case "session.setThinkingLevel":
		var request struct {
			SessionID string `json:"sessionId"`
			Level     string `json:"level"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		return ack(h.Sessions.SetThinking(ctx, request.SessionID, request.Level))
	case "session.getStats":
		var request struct {
			SessionID string `json:"sessionId"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		return h.Sessions.Stats(request.SessionID)
	case "model.clampThinking":
		var request struct {
			SessionID string `json:"sessionId"`
			Level     string `json:"level"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed session request")
		}
		level, err := h.Sessions.ClampThinking(request.SessionID, request.Level)
		if err != nil {
			return nil, err
		}
		return map[string]string{"level": level}, nil
	case "session.questionReply":
		var request struct {
			SessionID  string         `json:"sessionId"`
			ToolCallID string         `json:"toolCallId"`
			Result     map[string]any `json:"result"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed question response")
		}
		return ack(h.Sessions.ResolveQuestion(request.SessionID, request.ToolCallID, request.Result))
	case "session.goalGet", "session.goalSet", "session.goalClear":
		var request struct {
			ProjectID string `json:"projectId"`
			SessionID string `json:"sessionId"`
			Goal      string `json:"goal"`
		}
		if h.Sessions == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed objective request")
		}
		if _, err := h.Sessions.RecordedCWD(request.ProjectID, request.SessionID); err != nil {
			return nil, err
		}
		if method == "session.goalSet" {
			return h.Sessions.objectives.Update(request.ProjectID, request.SessionID, &request.Goal, nil)
		}
		if method == "session.goalClear" {
			if err := h.Sessions.objectives.ClearGoal(request.ProjectID, request.SessionID); err != nil {
				return nil, err
			}
		}
		return h.Sessions.objectives.Get(request.ProjectID, request.SessionID)
	case "settings.update":
		var request struct {
			Config AppConfigPatch `json:"config"`
		}
		if h.Settings == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed settings request")
		}
		return h.Settings.Update(request.Config)
	case "signet.status":
		if h.Settings == nil {
			return nil, fmt.Errorf("settings are not configured")
		}
		return h.Settings.SignetStatus(ctx)
	case "model.list":
		if h.Admin == nil {
			return nil, fmt.Errorf("Goose administration is not configured")
		}
		return h.Admin.Models(ctx)
	case "model.refresh":
		if h.Admin == nil {
			return nil, fmt.Errorf("Goose administration is not configured")
		}
		return h.Admin.RefreshModels(ctx)
	case "model.default":
		if h.Admin == nil {
			return nil, fmt.Errorf("Goose administration is not configured")
		}
		return h.Admin.DefaultModel(ctx)
	case "model.setVisibility":
		var request struct {
			Provider string `json:"provider"`
			ID       string `json:"id"`
			Hidden   bool   `json:"hidden"`
		}
		if h.Admin == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed model visibility request")
		}
		return h.Admin.SetModelVisibility(ctx, request.Provider, request.ID, request.Hidden)
	case "model.setAllVisibility":
		var request struct {
			Hidden bool `json:"hidden"`
		}
		if h.Admin == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed model visibility request")
		}
		return h.Admin.SetAllModelVisibility(ctx, request.Hidden)
	case "provider.status":
		if h.Admin == nil {
			return nil, fmt.Errorf("Goose administration is not configured")
		}
		return h.Admin.ProviderStatus(ctx)
	case "provider.readiness":
		var request struct {
			ProviderID string `json:"providerId"`
		}
		if h.Admin == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed provider readiness request")
		}
		return h.Admin.ProviderReadiness(ctx, request.ProviderID)
	case "provider.logout":
		var request struct {
			ProviderID string `json:"providerId"`
		}
		if h.Admin == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed provider request")
		}
		return ack(h.Admin.LogoutProvider(ctx, request.ProviderID))
	case "goose.preferencesRead":
		if h.Admin == nil {
			return nil, fmt.Errorf("Goose administration is not configured")
		}
		return h.Admin.ReadPreferences(ctx)
	case "goose.preferencesSave":
		var request GoosePreferences
		if h.Admin == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed Goose preferences request")
		}
		return h.Admin.SavePreferences(ctx, request)
	case "goose.preferencesReset":
		var request struct {
			Keys []string `json:"keys"`
		}
		if h.Admin == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed Goose preferences request")
		}
		return h.Admin.ResetPreferences(ctx, request.Keys)
	case "goose.defaultsRead":
		if h.Admin == nil {
			return nil, fmt.Errorf("Goose administration is not configured")
		}
		return h.Admin.ReadDefaults(ctx)
	case "goose.defaultsSave":
		var request struct {
			ProviderID string  `json:"providerId"`
			ModelID    *string `json:"modelId"`
		}
		if h.Admin == nil || decodeParams(raw, &request) != nil {
			return nil, fmt.Errorf("malformed Goose defaults request")
		}
		return h.Admin.SaveDefaults(ctx, request.ProviderID, request.ModelID)
	case "goose.defaultsClear":
		if h.Admin == nil {
			return nil, fmt.Errorf("Goose administration is not configured")
		}
		return h.Admin.ClearDefaults(ctx)
	case "goose.status":
		if h.Admin == nil {
			return nil, fmt.Errorf("Goose administration is not configured")
		}
		return runtimeGooseStatus(ctx, h.Admin.client), nil
	default:
		if h.Admin != nil {
			return h.Admin.Handle(ctx, method, raw, clientKey)
		}
		return nil, fmt.Errorf("unknown method: %s", method)
	}
}

type fileRequest struct {
	ProjectID string `json:"projectId"`
	Root      string `json:"root"`
	Path      string `json:"path"`
}

type sessionOwnerRequest struct {
	ProjectID string `json:"projectId"`
	SessionID string `json:"sessionId"`
}

func ack(err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return map[string]bool{"ok": true}, nil
}

func (h CoreHandler) ensureWatch(projectID string) error {
	if h.Watches == nil {
		return nil
	}
	_, err := h.Watches.Ensure(projectID)
	return err
}

func (r fileRequest) valid() bool {
	return r.ProjectID != "" && r.Root != "" && !containsNUL(r.ProjectID) && !containsNUL(r.Root) && !containsNUL(r.Path)
}

func decodeParams(raw json.RawMessage, target any) error {
	if len(raw) == 0 || string(raw) == "null" {
		raw = []byte("{}")
	}
	return json.Unmarshal(raw, target)
}
