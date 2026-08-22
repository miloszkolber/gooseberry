# Paseo + Pi comparison variant

This variant tests Paseo as the controller while reusing the same repo-owned Pi extensions, same-path host mounts, transparent SSH execution, isolated browser service, and single state directory as the Synara draft.

## Why test it

Paseo launches Pi as a native JSONL-RPC subprocess. Pi remains responsible for its own credentials, settings, extensions, skills, sessions, models, and tool behavior. This is a cleaner provider boundary than embedding Pi's SDK and replacing services inside the controller.

## What it does not solve

Paseo's terminal, file explorer, Git, and worktree services are local to the Paseo daemon. Therefore:

- the standalone terminal still runs in the controller container;
- Files and Changes work for same-path mounted roots;
- SFTP-only paths remain visible to Pi but not to Paseo's Files or Changes panes;
- going fully remote would still require a Paseo workspace transport or running the daemon on the host.

Paseo is also not distroless in full-featured mode. Its official image includes Bash, Git, OpenSSH, process utilities, `tini`, and native PTY support. This variant tests lower Pi coupling, not a smaller final runtime.

## State layout

Create one writable state directory for the complete comparison stack:

```text
data-paseo/
├── paseo/
├── pi/
├── .config/
├── .local/
├── .cache/
└── browser/
```

The home, data, and repository roots remain same-path host bind mounts. They contain development content, not controller state.

## Start

From `variants/paseo-pi`:

```sh
mkdir -p ../../data-paseo/browser
chown -R 1000:1000 ../../data-paseo
cp ../../.env.example ../../.env
# Add PASEO_PASSWORD to ../../.env.
docker compose up -d --build
```

Open `http://127.0.0.1:6767`.

## Comparison criteria

Test the same repository and tasks in both variants:

1. Pi model and extension discovery.
2. Project `AGENTS.md` and skill discovery.
3. `read`, `write`, `edit`, `grep`, `find`, `ls`, and SSH-backed `bash` behavior.
4. Interactive `question` requests.
5. Plan mode.
6. Browser snapshots and screenshots.
7. Session resume and compaction.
8. Parallel-agent orchestration.
9. Files, Changes, worktrees, and terminal behavior.
10. Idle memory, startup time, image size, and update friction.

Use the result to decide whether Paseo's orchestration and native Pi boundary outweigh its larger daemon surface and the unchanged local-workspace limitations.
