import { resolve } from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type BashOperations,
  type EditOperations,
  type ExtensionAPI,
  type FindOperations,
  type LsOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { RemoteWorkspace } from "../../src/remote-workspace";

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(Type.String({ description: "Optional glob filter" })),
  ignoreCase: Type.Optional(Type.Boolean()),
  literal: Type.Optional(Type.Boolean()),
  context: Type.Optional(Type.Number({ minimum: 0, maximum: 20 })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
});

/**
 * Keep Pi's model-facing filesystem and shell tools native while selecting the
 * backend below them:
 *
 * - paths inside MEWA_LOCAL_ROOTS use the same-path bind mounts;
 * - other paths fall back to SFTP when enabled;
 * - process execution always happens on the SSH host.
 *
 * Registration occurs during session_start. Synara supplies an SDK-level bash
 * tool during initial Pi construction, and Pi resolves duplicate tool names by
 * the latest registration. Registering here makes the host backend the final
 * definition without exposing SSH as a separate model tool.
 */
export default function mewaRemote(pi: ExtensionAPI) {
  const workspace = RemoteWorkspace.fromEnv();

  const read: ReadOperations = {
    readFile: (path) => workspace.readFile(path),
    access: (path) => workspace.access(path),
    detectImageMimeType: (path) => workspace.detectImageMimeType(path),
  };

  const write: WriteOperations = {
    writeFile: (path, content) => workspace.writeFile(path, content),
    mkdir: (dir) => workspace.mkdir(dir),
  };

  const edit: EditOperations = {
    readFile: (path) => workspace.readFile(path),
    writeFile: (path, content) => workspace.writeFile(path, content),
    access: (path) => workspace.access(path),
  };

  const bash: BashOperations = {
    exec: async (command, cwd, execution) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      execution.signal?.addEventListener("abort", abort, { once: true });
      const timeout = execution.timeout
        ? setTimeout(() => controller.abort(), execution.timeout * 1000)
        : undefined;
      try {
        const result = await workspace.exec(
          command,
          cwd,
          controller.signal,
          execution.onData,
          execution.env,
        );
        if (execution.signal?.aborted) throw new Error("aborted");
        if (controller.signal.aborted && !execution.signal?.aborted) {
          throw new Error(`timeout:${String(execution.timeout)}`);
        }
        return { exitCode: result.exitCode };
      } finally {
        if (timeout) clearTimeout(timeout);
        execution.signal?.removeEventListener("abort", abort);
      }
    },
  };

  const ls: LsOperations = {
    exists: (path) => workspace.exists(path),
    stat: (path) => workspace.stat(path),
    readdir: (path) => workspace.readdir(path),
  };

  const find: FindOperations = {
    exists: (path) => workspace.exists(path),
    glob: (pattern, cwd, options) => workspace.find(pattern, cwd, options),
  };

  pi.on("session_start", async (_event, ctx) => {
    const cwd = ctx.cwd;

    pi.registerTool(createReadToolDefinition(cwd, { operations: read }));
    pi.registerTool(createWriteToolDefinition(cwd, { operations: write }));
    pi.registerTool(createEditToolDefinition(cwd, { operations: edit }));
    pi.registerTool(createBashToolDefinition(cwd, { operations: bash }));
    pi.registerTool(createLsToolDefinition(cwd, { operations: ls }));
    pi.registerTool(createFindToolDefinition(cwd, { operations: find }));
    pi.registerTool({
      name: "grep",
      label: "grep",
      description:
        "Search file contents on the development host. Respects the host's ripgrep configuration and returns matching paths and lines.",
      promptSnippet: "Search file contents for patterns (respects .gitignore)",
      parameters: grepSchema,
      async execute(_toolCallId, params, signal, _onUpdate, toolContext) {
        const searchPath = resolve(toolContext.cwd, params.path ?? ".");
        const output = await workspace.grep({
          pattern: params.pattern,
          path: searchPath,
          glob: params.glob,
          ignoreCase: params.ignoreCase,
          literal: params.literal,
          context: params.context,
          limit: Math.max(1, Math.min(1000, params.limit ?? 100)),
          signal,
        });
        return {
          content: [{ type: "text", text: output }],
          details: { backend: "host" },
        };
      },
    });

    // Refresh existing active names so replacements take effect immediately,
    // without enabling optional read-only tools that the user did not select.
    pi.setActiveTools(pi.getActiveTools());
    ctx.ui.setStatus(
      "mewa-host",
      ctx.ui.theme.fg(
        "accent",
        workspace.localRoots.length > 0
          ? `host · ${workspace.localRoots.length} mounted roots`
          : "host · SFTP",
      ),
    );
  });

  // User-entered ! commands use the same host process boundary as model bash.
  pi.on("user_bash", () => ({ operations: bash }));

  pi.on("session_shutdown", async () => {
    workspace.close();
  });
}
