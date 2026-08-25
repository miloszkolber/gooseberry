# Architecture

## Components

```text
Web UI ─────────────┐
                    ├─ Mewa controller ── Pi SDK ── upstream Pi
ACP (stdio NDJSON) ─┘        │                  │
                             │                  ├─ mewa-remote ── OpenSSH ── host shell
                             │                  ├─ subagents
                             │                  ├─ goals/tasks
                             │                  ├─ web access
                             │                  ├─ browser tool ── mewa-browser
                             │                  └─ optional Signet
                             │
                             ├─ project/session metadata
                             ├─ bounded read-only file projection
                             └─ Git discovery/status/diff projection
```

The controller owns the browser/ACP transport and projects Pi sessions. Pi owns the agent lifecycle, provider/model catalogs, normal tools, canonical JSONL sessions, retry, compaction, trust, and usage accounting.

## Projects and paths

A project contains one or more approved absolute directory roots. A project root may be a repository, a directory containing several repositories, or a non-Git directory.

`MEWA_MOUNT_ROOTS` is the deployment admission boundary. Project roots and session working directories must resolve below an admitted same-path mount and must not overlap controller/Pi state. Existing symlinks may not escape an admitted root.

The first root is the default session working directory unless the user selects another admitted path. Project identity is not tied to one Git repository or branch.

## Git projection

The controller performs bounded discovery of Git repositories below project roots. Git is read-only from the product UI:

- repository root and relative location;
- current branch or detached HEAD;
- clean/dirty state;
- changed and untracked paths;
- readable local diffs.

Agents change Git state through normal Bash. The UI refreshes and reflects it; it does not implement branch, staging, worktree, or hosting-provider workflows.

## File projection

Files are read only through admitted project roots. The UI exposes a bounded tree and text preview. Source highlighting is a browser concern handled by Shiki. No save/edit protocol is part of the product.

## SSH execution (`mewa-remote`)

Pi's `bash` tool keeps Pi's public schema and renderer. A built-in extension replaces only its execution operations:

```text
Pi bash call
  → mewa-remote
  → system OpenSSH client
  → `bash -lc` on the configured host account
```

SSH is not model-facing. The child process receives a minimal environment and never receives provider credentials, controller/browser tokens, or unrelated controller state. Strict host-key checking, batch mode, an explicit private key, and a known-hosts file are required.

Mewa does not use SFTP. Files and Git use admitted same-path mounts; paths outside those mounts fail clearly.

## Pi extensions

Built-in extensions are in-process trusted controller code and use Pi's SDK:

- protected-state guard;
- `mewa-remote` Bash operations;
- isolated browser QA;
- web search/fetch;
- goal/tasks;
- structured subagents;
- optional Signet connector.

The fixed Mewa profile is assembled by the controller. Non-Mewa user/project resources remain Pi-owned and are not managed through a Mewa package UI.

## Subagents and routing

A child is a normal persistent Pi session in the controller's process-global session registry. It inherits the parent runtime generation, project, admitted working directory, guards, and integrations.

Role policy is typed controller data:

```text
scout       read-only exploration/research
builder     scoped implementation
strategist  read-only architecture/planning
auditor     read-only independent review
```

Children cannot invoke the subagent tool. Read-only roles receive no edit/write tools.

Roles reference provider-agnostic model groups (`economy`, `balanced`, `strong`, `deep`) and allowed reasoning ranges. A central resolver maps those groups to currently available Pi models and chooses the lowest-cost healthy candidate satisfying the request.

## Goals and tasks

Mewa owns one optional session goal and a small task list. The state is stored separately from Pi's canonical transcript. A Pi extension injects concise ephemeral context and provides a structured task-update tool. Clearing the objective removes future context without rewriting prior transcript entries.

## State

Pi credentials, settings, and canonical sessions stay in Pi-owned storage. Mewa stores only:

- project registry and roots;
- UI preferences needed by the retained shell;
- session-to-project presentation metadata;
- goals/tasks and subagent relationship metadata;
- optional integration settings such as Signet enablement/endpoint.

All persistent writes use bounded paths and safe replacement so a failed update leaves the last valid state.

## Browser boundary

`mewa-browser` is a separate non-root, read-only container. It receives no repository mount, Pi/provider state, or SSH material. Its API exposes only bounded HTTP(S) visual-QA operations with independent authentication, deadlines, quotas, safe artifacts, and cleanup.

## Runtime images

The controller final image contains only retained compiled application assets, production dependencies, Git, Bash, OpenSSH client, CA certificates, and a small init where required. It contains no terminal PTY runtime, editor, source tree, tests, compiler, or package cache.

The Web UI and ACP are primary. There is no TUI and no browser terminal.
