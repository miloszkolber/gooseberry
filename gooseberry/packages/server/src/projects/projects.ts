import { randomUUID } from "node:crypto";
import { basename, isAbsolute, relative } from "node:path";
import { normalizeProjectIcon, normalizeProjectName, type Project } from "@gooseberry/contracts";
import { canonicalPath } from "../git";
import { assertMountedDirectory, assertMountedProject } from "../path-admission";
import { loadProjects, saveProjects } from "../persistence";

type ProjectPublisher = (project: Project) => void;

let publishProject: ProjectPublisher | null = null;

export function setProjectPublisher(fn: ProjectPublisher | null): void {
	publishProject = fn;
}

function emit(project: Project): void {
	publishProject?.(project);
}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project"
	);
}

function uniqueSlug(base: string, taken: Set<string>): string {
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

function ensureSlugs(projects: Project[]): boolean {
	const taken = new Set(projects.map((p) => p.slug).filter(Boolean));
	let changed = false;
	for (const project of projects) {
		if (!project.slug) {
			project.slug = uniqueSlug(slugify(project.name), taken);
			taken.add(project.slug);
			changed = true;
		}
	}
	return changed;
}

export function getProjects(): Project[] {
	const projects = loadProjects();
	for (const project of projects) {
		if (project.roots.length === 0) throw new Error(`Project has no roots: ${project.id}`);
		project.roots = project.roots.map((root) => assertMountedProject(root));
	}
	if (ensureSlugs(projects)) saveProjects(projects);
	return projects;
}

export function openProject(path: string): Project {
	const mountedRoot = assertMountedProject(path);

	const projects = getProjects();
	const existing = projects.find((project) =>
		project.roots.some((root) => canonicalPath(root) === mountedRoot),
	);
	if (existing) {
		delete existing.closed;
		existing.lastOpened = Date.now();
		saveProjects(projects);
		emit(existing);
		return existing;
	}

	const taken = new Set(projects.map((p) => p.slug));
	const project: Project = {
		id: randomUUID(),
		name: basename(mountedRoot),
		roots: [mountedRoot],
		slug: uniqueSlug(slugify(basename(mountedRoot)), taken),
		lastOpened: Date.now(),
	};
	projects.push(project);
	saveProjects(projects);
	emit(project);
	return project;
}

export function getProject(id: string): Project {
	const project = getProjects().find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	return project;
}

export function addProjectRoot(id: string, path: string): Project {
	const root = assertMountedProject(path);
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const owner = projects.find(
		(candidate) =>
			candidate.id !== id && candidate.roots.some((known) => canonicalPath(known) === root),
	);
	if (owner) throw new Error(`Directory is already a root of project ${owner.name}`);
	if (!project.roots.some((known) => canonicalPath(known) === root)) project.roots.push(root);
	project.lastOpened = Date.now();
	saveProjects(projects);
	emit(project);
	return project;
}

export function removeProjectRoot(id: string, path: string): Project {
	const wanted = canonicalPath(assertMountedProject(path));
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	if (project.roots.length === 1) throw new Error("A project must keep at least one root");
	const next = project.roots.filter((root) => canonicalPath(root) !== wanted);
	if (next.length === project.roots.length) throw new Error("Project root not found");
	project.roots = next;
	saveProjects(projects);
	emit(project);
	return project;
}

export function updateProject(id: string, update: { name?: unknown; icon?: unknown }): Project {
	if (update.name === undefined && update.icon === undefined) {
		throw new Error("Project update requires a name or icon");
	}
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	if (update.name !== undefined) project.name = normalizeProjectName(update.name);
	if (update.icon !== undefined) project.icon = normalizeProjectIcon(update.icon);
	project.lastOpened = Date.now();
	saveProjects(projects);
	emit(project);
	return project;
}

function isWithin(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertProjectCwd(projectId: string, cwd?: string): string {
	const project = getProject(projectId);
	const defaultRoot = project.roots[0];
	if (!defaultRoot) throw new Error(`Project has no roots: ${projectId}`);
	const candidate = assertMountedDirectory(cwd?.trim() || defaultRoot, "Session directory");
	if (!project.roots.some((root) => isWithin(root, candidate))) {
		throw new Error("Session directory is outside the project roots");
	}
	return candidate;
}

function newestFirst(projects: Project[]): Project[] {
	return projects.sort((a, b) => b.lastOpened - a.lastOpened);
}

export function listProjects(): Project[] {
	return newestFirst(getProjects().filter((project) => project.closed !== true));
}

export function listRecentProjects(): Project[] {
	return newestFirst(getProjects());
}

export function closeProject(id: string): Project {
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.closed = true;
	saveProjects(projects);
	emit(project);
	return project;
}
