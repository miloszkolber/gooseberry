---
id: goal-and-requirements
type: goal-and-requirements
status: active
title: Mewa Code — product goal and scope
covers: [product-goal, v1-scope, v2-scope, engine-decision]
tags: [product, scope]
---

## Goal

Mewa Code is a desktop-and-mobile client for the `pi` coding agent. The product
is a thin host that bridges `pi` to a rich UI and, over time, layers spec-driven workflows on top.

## Engine

PI agent only. No second runtime (no `claude-agent-sdk`), in V1 or V2. `pi` owns the model registry,
system prompt, skills/extensions, compaction, retry behavior, stats, cost, and canonical JSONL session
state. Every feature influences the agent by what we **feed** `pi` — prompt context, files, `pi`'s own
skills/extensions — and which flags we spawn it with, never by assembling the prompt ourselves. Mewa Code
does not inject its own defaults, maintain a second model/credential registry, recompute Pi-reported stats,
or mutate Pi configuration except through explicit user actions such as provider login or settings changes.
The only current host-level settings exception disables Pi's automatic image resizing in memory so the
transport can preserve raw image inputs and apply its documented provider safety guard.

This is the target contract. The imported foundation still injects inherited bundled workflow, web,
visualization, spec-graph, todo, and host-bridge extensions. Separating mandatory UI adapters from optional
Pi extensions is follow-up adaptation work and is not claimed complete by the foundation import.

## V1 — Worktree IDE + cheap wins

A Mewa Code, git-worktree IDE, driven by a CLI you run that opens a browser UI.
The shell is built first, `pi` connected last:

- **Projects → workspaces**: open a git repo as a project; a workspace is a `git worktree` (own branch +
  cwd) under `~/.mewa-code/worktrees` — plus one built-in, non-removable **Default workspace** per
  project (the project folder itself), offered as an explicit choice on the project's Welcome so
  newcomers aren't lost in the worktree model, and any **existing worktree** the user attaches in place
  from the project menu (Mewa Code uses its cwd, never touches its checkout).
- **Desktop workbench**: a recursively splittable center for files, diffs, registered documents, chats, and terminals,
  bounded to four visible groups; Projects / Specs / All files / Changes / Review live in movable,
  independently foldable vertical side groups. Terminal tabs may move between center and sides. Each
  workspace's structural layout is host-persisted and shared across clients, while active selection/focus
  remains local so clients do not steal one another's attention.
- A workspace-local **Review** surface for the current worktree: GitHub-style anchored file/diff drafts
  are collected without starting the agent, then sent as structured context into per-file `pi` chats;
  sent records persist and the agent can resolve them. This is local review, not PR-provider integration.
- Cheap wins `pi` already emits: per-session model pick (#1), token/cost display (#3), and skill
  catalog/autocomplete (#2), including read-through reuse of portable Agent Skills a user already keeps
  for major coding agents — Pi remains the parser/runtime; no copying or vendor-semantic emulation. A
  repo's **committed** skill aliases load only after an explicit **per-project trust** grant (a clone's are
  attacker-controlled); personal + bundled skills load regardless.
- Multiple chat sessions per workspace, streaming concurrently (#5).
- A bundled **spec-graph** pi extension (`pi-spec-graph`): the agent searches, navigates, and manages
  the project's specs via `spec_*` tools + a skill.
- A read-only **Specs** side tool: the active worktree's spec-graph rendered as its `parent` tree, backed
  by the same `pi-spec-graph` core model host-side;
  opening a node opens the spec file as an editor tab. Viewer only — no editing, drift detection, or
  graph canvas.
- Mewa Code branding: **green accent** (`#8dff4f` on the dark-family themes, `#2e7d16` on the light
  ones — inverse by appearance so it clears AA on both), Darcula background, **Orbitron** for the brand
  display role, Geist / Geist Mono for UI and code.
- On-disk state under `~/.mewa-code`.

V1 is explicitly **not**: the workflow **product layer** (a runtime/engine, configurable pipelines —
the skill-based workflow *system*, skills + an always-on rule with no runtime machinery, ships as the
bundled `pi-mewa-code-workflow` extension); the spec-graph **product layer** beyond the read-only viewer
(drift detection, pre-build approval, living graph — the pi-side spec capability ships as the bundled
extension above); PR / Checks beyond the active workspace's optional open GitHub PR / GitLab MR number, self-improvement, automations, per-step model routing, cost ledger.

## V2 — the product

Workflow layer (#8), spec layer (#9: pre-build approval → drift detection → living spec graph, building
on the V1 spec-graph extension), self-improvement (#4), configurable automations (#6), remote/phone over
Tailscale (#7), and deepened parallelism / cost ledger / per-step routing.
