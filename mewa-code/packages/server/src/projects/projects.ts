import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Project } from "@mewa-code/contracts";
import { canonicalPath, git as runGit } from "../git";
import { assertMountedProject } from "../pathAdmission";
import { loadProjects, loadWorkspaces, saveProjects } from "../persistence";

type ProjectPublisher = (project: Project) => void;

let publishProject: ProjectPublisher | null = null;

export function setProjectPublisher(fn: ProjectPublisher | null): void {
	publishProject = fn;
}

function emit(project: Project): void {
	publishProject?.(project);
}

function git(cwd: string, args: string[]) {
	return runGit(cwd, args, { env: process.env });
}

function gitToplevel(path: string): string | null {
	const result = git(path, ["rev-parse", "--show-toplevel"]);
	return result.ok ? result.out || null : null;
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
		assertMountedProject(project.path);
	}
	if (ensureSlugs(projects)) saveProjects(projects);
	return projects;
}

export function openProject(path: string): Project {
	const mountedPath = assertMountedProject(path);
	const root = gitToplevel(mountedPath);
	if (!root) throw new Error(`Not a git repository: ${path}`);
	const mountedRoot = assertMountedProject(root);

	const projects = getProjects();
	const existing = projects.find((p) => canonicalPath(p.path) === mountedRoot);
	if (existing) {
		delete existing.closed;
		existing.lastOpened = Date.now();
		saveProjects(projects);
		emit(existing);
		return existing;
	}

	const wanted = mountedRoot;
	if (loadWorkspaces().some((ws) => canonicalPath(ws.worktreePath) === wanted))
		throw new Error(`This folder is already open in Mewa Code as a workspace: ${mountedRoot}`);

	const taken = new Set(projects.map((p) => p.slug));
	const project: Project = {
		id: randomUUID(),
		name: basename(mountedRoot),
		path: mountedRoot,
		slug: uniqueSlug(slugify(basename(mountedRoot)), taken),
		lastOpened: Date.now(),
	};
	projects.push(project);
	saveProjects(projects);
	emit(project);
	return project;
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

export function setProjectTrust(id: string, trusted: boolean): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.trusted = trusted;
	saveProjects(projects);
	return project;
}

export function setProjectSkillEnabled(id: string, name: string, enabled: boolean): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const disabled = new Set(project.disabledSkills ?? []);
	if (enabled) disabled.delete(name);
	else disabled.add(name);
	project.disabledSkills = [...disabled];
	saveProjects(projects);
	return project;
}

export function setProjectGroupEnabled(id: string, group: string, enabled: boolean): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const groups = new Set(project.disabledGroups ?? []);
	if (enabled) groups.delete(group);
	else groups.add(group);
	project.disabledGroups = [...groups];
	saveProjects(projects);
	return project;
}

export function isProjectTrusted(id: string): boolean {
	return getProjects().find((p) => p.id === id)?.trusted === true;
}
