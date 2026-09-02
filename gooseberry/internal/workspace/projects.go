package workspace

import (
	"cmp"
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/miloszkolber/gooseberry/internal/identifier"
	"github.com/miloszkolber/gooseberry/internal/persist"
)

var (
	slugCharacters = regexp.MustCompile(`[^a-z0-9]+`)
	projectIcons   = map[string]bool{"folder": true, "code": true, "book": true, "flask": true, "rocket": true, "sparkles": true}
)

type Projects struct {
	mu       sync.RWMutex
	store    persist.Store
	policy   *PathPolicy
	now      func() time.Time
	publish  func(Project)
	loaded   bool
	projects []Project
}

func NewProjects(store persist.Store, policy *PathPolicy) *Projects {
	return &Projects{store: store, policy: policy, now: time.Now}
}

func utf16Length(value string) int {
	count := 0
	for _, character := range value {
		count += utf16.RuneLen(character)
	}
	return count
}

func (p *Projects) SetPublisher(publish func(Project)) {
	p.mu.Lock()
	p.publish = publish
	p.mu.Unlock()
}

type persistedProject struct {
	Project
	Path string `json:"path,omitempty"`
}

func (p *Projects) load() ([]Project, error) {
	// This process is the sole owner of project state. Load and validate once,
	// then keep a private snapshot synchronized with each atomic write.
	if p.loaded {
		return cloneProjects(p.projects), nil
	}
	var persisted []persistedProject
	for _, name := range []string{"projects.json", "projects.json.bak"} {
		raw, _, err := persist.ReadFile(filepath.Join(p.store.Dir, name))
		if err != nil {
			continue
		}
		var decoded []persistedProject
		if persist.Decode(raw, &decoded, validateProjects) != nil {
			continue
		}
		persisted = decoded
		break
	}
	projects := make([]Project, 0, len(persisted))
	migrated := false
	for _, entry := range persisted {
		roots := slices.Clone(entry.Roots)
		if len(roots) == 0 && entry.Path != "" {
			roots = []string{entry.Path}
			migrated = true
		}
		if entry.ID == "" || len(roots) == 0 {
			continue
		}
		for index, root := range roots {
			canonical, resolveErr := p.policy.Directory(root, "Project")
			if resolveErr != nil {
				return nil, resolveErr
			}
			roots[index] = canonical
		}
		projects = append(projects, Project{
			ID: entry.ID, Name: entry.Name, Roots: roots, Slug: entry.Slug,
			LastOpened: entry.LastOpened, Icon: entry.Icon, Closed: entry.Closed,
		})
	}
	if ensureSlugs(projects) {
		migrated = true
	}
	if migrated {
		if err := p.save(projects); err != nil {
			return nil, err
		}
	} else {
		p.projects = cloneProjects(projects)
		p.loaded = true
	}
	return cloneProjects(projects), nil
}

func (p *Projects) ensureLoaded() error {
	p.mu.RLock()
	if p.loaded {
		p.mu.RUnlock()
		return nil
	}
	p.mu.RUnlock()

	p.mu.Lock()
	defer p.mu.Unlock()
	_, err := p.load()
	return err
}

func (p *Projects) save(projects []Project) error {
	values := make([]persistedProject, len(projects))
	for index, project := range projects {
		values[index].Project = project
	}
	if err := persist.Write(p.store, "projects.json", values, validateProjects); err != nil {
		return err
	}
	p.projects = cloneProjects(projects)
	p.loaded = true
	return nil
}

func cloneProjects(projects []Project) []Project {
	result := make([]Project, len(projects))
	for index, project := range projects {
		result[index] = project
		result[index].Roots = slices.Clone(project.Roots)
	}
	return result
}

func validateProjects(values []persistedProject) error {
	if values == nil {
		return fmt.Errorf("projects must be an array")
	}
	for _, value := range values {
		if value.ID == "" || value.Roots == nil && value.Path == "" || value.Icon != "" && !projectIcons[value.Icon] {
			return fmt.Errorf("invalid persisted project")
		}
	}
	return nil
}

func (p *Projects) List(includeClosed bool) ([]Project, error) {
	if err := p.ensureLoaded(); err != nil {
		return nil, err
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	filtered := make([]Project, 0, len(p.projects))
	for _, project := range p.projects {
		if includeClosed || !project.Closed {
			project.Roots = slices.Clone(project.Roots)
			filtered = append(filtered, project)
		}
	}
	slices.SortStableFunc(filtered, func(a, b Project) int { return cmp.Compare(b.LastOpened, a.LastOpened) })
	return filtered, nil
}

func (p *Projects) Get(id string) (Project, error) {
	if err := p.ensureLoaded(); err != nil {
		return Project{}, err
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	var result Project
	found := false
	for _, project := range p.projects {
		if project.ID == id && (!found || project.LastOpened > result.LastOpened) {
			result, found = project, true
		}
	}
	if !found {
		return Project{}, fmt.Errorf("unknown project: %s", id)
	}
	result.Roots = slices.Clone(result.Roots)
	return result, nil
}

func (p *Projects) Open(path string) (result Project, err error) {
	p.mu.Lock()
	defer p.finishMutation(&result, &err)
	root, err := p.policy.Directory(path, "Project")
	if err != nil {
		return Project{}, err
	}
	projects, err := p.load()
	if err != nil {
		return Project{}, err
	}
	for index := range projects {
		for _, known := range projects[index].Roots {
			if known == root {
				projects[index].Closed = false
				projects[index].LastOpened = float64(p.now().UnixMilli())
				if err := p.save(projects); err != nil {
					return Project{}, err
				}
				return projects[index], nil
			}
		}
	}
	name := filepath.Base(root)
	taken := make(map[string]bool, len(projects))
	for _, project := range projects {
		taken[project.Slug] = true
	}
	project := Project{ID: identifier.New(), Name: name, Roots: []string{root}, Slug: uniqueSlug(slugify(name), taken), LastOpened: float64(p.now().UnixMilli())}
	projects = append(projects, project)
	if err := p.save(projects); err != nil {
		return Project{}, err
	}
	return project, nil
}

func (p *Projects) AddRoot(id, path string) (result Project, err error) {
	p.mu.Lock()
	defer p.finishMutation(&result, &err)
	root, err := p.policy.Directory(path, "Project")
	if err != nil {
		return Project{}, err
	}
	projects, err := p.load()
	if err != nil {
		return Project{}, err
	}
	index := projectIndex(projects, id)
	if index < 0 {
		return Project{}, fmt.Errorf("unknown project: %s", id)
	}
	for otherIndex, other := range projects {
		if otherIndex != index && contains(other.Roots, root) {
			return Project{}, fmt.Errorf("directory is already a root of project %s", other.Name)
		}
	}
	if !contains(projects[index].Roots, root) {
		projects[index].Roots = append(projects[index].Roots, root)
	}
	projects[index].LastOpened = float64(p.now().UnixMilli())
	if err := p.save(projects); err != nil {
		return Project{}, err
	}
	return projects[index], nil
}

func (p *Projects) RemoveRoot(id, path string) (result Project, err error) {
	p.mu.Lock()
	defer p.finishMutation(&result, &err)
	root, err := p.policy.Directory(path, "Project")
	if err != nil {
		return Project{}, err
	}
	projects, err := p.load()
	if err != nil {
		return Project{}, err
	}
	index := projectIndex(projects, id)
	if index < 0 {
		return Project{}, fmt.Errorf("unknown project: %s", id)
	}
	if len(projects[index].Roots) == 1 {
		return Project{}, fmt.Errorf("a project must keep at least one root")
	}
	next := make([]string, 0, len(projects[index].Roots)-1)
	for _, known := range projects[index].Roots {
		if known != root {
			next = append(next, known)
		}
	}
	if len(next) == len(projects[index].Roots) {
		return Project{}, fmt.Errorf("project root not found")
	}
	projects[index].Roots = next
	if err := p.save(projects); err != nil {
		return Project{}, err
	}
	return projects[index], nil
}

func (p *Projects) Update(id string, name, icon *string) (result Project, err error) {
	if name == nil && icon == nil {
		return Project{}, fmt.Errorf("project update requires a name or icon")
	}
	p.mu.Lock()
	defer p.finishMutation(&result, &err)
	projects, err := p.load()
	if err != nil {
		return Project{}, err
	}
	index := projectIndex(projects, id)
	if index < 0 {
		return Project{}, fmt.Errorf("unknown project: %s", id)
	}
	if name != nil {
		normalized := strings.TrimSpace(*name)
		if normalized == "" || strings.ContainsRune(normalized, 0) || utf16Length(normalized) > 100 {
			return Project{}, fmt.Errorf("invalid project name")
		}
		projects[index].Name = normalized
	}
	if icon != nil {
		if !projectIcons[*icon] {
			return Project{}, fmt.Errorf("unknown project icon")
		}
		projects[index].Icon = *icon
	}
	projects[index].LastOpened = float64(p.now().UnixMilli())
	if err := p.save(projects); err != nil {
		return Project{}, err
	}
	return projects[index], nil
}

func (p *Projects) Close(id string) (result Project, err error) {
	p.mu.Lock()
	defer p.finishMutation(&result, &err)
	projects, err := p.load()
	if err != nil {
		return Project{}, err
	}
	index := projectIndex(projects, id)
	if index < 0 {
		return Project{}, fmt.Errorf("unknown project: %s", id)
	}
	projects[index].Closed = true
	if err := p.save(projects); err != nil {
		return Project{}, err
	}
	return projects[index], nil
}

func (p *Projects) finishMutation(result *Project, err *error) {
	publish := p.publish
	p.mu.Unlock()
	if *err == nil && publish != nil {
		publish(*result)
	}
}

func (p *Projects) AssertCWD(projectID, cwd string) (string, error) {
	project, err := p.Get(projectID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(cwd) == "" {
		cwd = project.Roots[0]
	}
	candidate, err := p.policy.Directory(cwd, "Session directory")
	if err != nil {
		return "", err
	}
	for _, root := range project.Roots {
		if Within(root, candidate) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("session directory is outside the project roots")
}

func (p *Projects) AssertRoot(projectID, root string) (string, error) {
	project, err := p.Get(projectID)
	if err != nil {
		return "", err
	}
	// Get already resolves and authorizes each root against the current mount.
	if contains(project.Roots, root) {
		return root, nil
	}
	candidate, err := p.policy.Directory(root, "Project root")
	if err != nil {
		return "", err
	}
	if !contains(project.Roots, candidate) {
		return "", fmt.Errorf("project root must exactly match an admitted project root")
	}
	return candidate, nil
}

func projectIndex(projects []Project, id string) int {
	for index := range projects {
		if projects[index].ID == id {
			return index
		}
	}
	return -1
}

func slugify(name string) string {
	slug := strings.Trim(slugCharacters.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		return "project"
	}
	return slug
}

func uniqueSlug(base string, taken map[string]bool) string {
	if !taken[base] {
		return base
	}
	for suffix := 2; ; suffix++ {
		candidate := fmt.Sprintf("%s-%d", base, suffix)
		if !taken[candidate] {
			return candidate
		}
	}
}

func ensureSlugs(projects []Project) bool {
	if !slices.ContainsFunc(projects, func(project Project) bool { return project.Slug == "" }) {
		return false
	}
	taken := make(map[string]bool, len(projects))
	for _, project := range projects {
		if project.Slug != "" {
			taken[project.Slug] = true
		}
	}
	changed := false
	for index := range projects {
		if projects[index].Slug == "" {
			projects[index].Slug = uniqueSlug(slugify(projects[index].Name), taken)
			taken[projects[index].Slug] = true
			changed = true
		}
	}
	return changed
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
