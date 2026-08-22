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
import { RemoteWorkspace } from "../../src/remote-workspace.js";

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
 * tool after extension loading, so startup registration is required for the
 * mewa definitions to take precedence.
 */
export default function mewaRemote(pi: ExtensionAPI) {
  const remote = RemoteWorkspace.fromEnv();

  const read: ReadOperations = {
    readFile: (path) => remote.readFile(path),
    access: (path) => remote.access(path),
    detectImageMimeType: (path) => remote.detectImageMimeType(path),
  };

  const write: WriteOperations = {
    writeFile: (path, content) => remote.writeFile(path, content),
    mkdir: (dir) => remote.mkdir(dir),
  };

  const edit: EditOperations = {
    readFile: (path) => remote.readFile(path),
    writeFile: (path, content) => remote.writeFile(path, content),
    access: (path) => remote.access(path),
  };

  const ls: LsOperations = {
    exists: (path) => remote.exists(path),
    stat: (path) => remote.stat(path),
    readdir: (path) => remote.readdir(path),
  };

  const find: FindOperations = {
    exists: (path) => remote.exists(path),
    glob: (pattern, cwd, options) => remote.find(pattern, cwd, options),
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
        const result = await remote.exec(
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

  const registerRemoteTools = (cwd: string) => {
    pi.registerTool(createReadToolDefinition(cwd, { operations: read }));
    pi.registerTool(createWriteToolDefinition(cwd, { operations: write }));
    pi.registerTool(createEditToolDefinition(cwd, { operations: edit }));
    pi.registerTool(createLsToolDefinition(cwd, { operations: ls }));
    pi.registerTool(createFindToolDefinition(cwd, { operations: find }));
    pi.registerTool(createBashToolDefinition(cwd, { operations: bash }));
    pi.registerTool({
      name: "grep",
      label: "grep",
      description:
        "Search file contents on the development host. Respects the host filesystem and returns bounded matching lines.",
      promptSnippet: "Search file contents for patterns on the development host",
      parameters: grepSchema,
      async execute(_toolCallId, params, signal) {
        const path = resolve(cwd, params.path ?? ".");
        const text = await remote.grep({
          pattern: params.pattern,
          path,
          glob: params.glob,
          ignoreCase: params.ignoreCase,
          literal: params.literal,
          context: params.context,
          limit: params.limit ?? 100,
          signal,
        });
        return {
          content: [{ type: "text", text }],
          details: { path, limit: params.limit ?? 100 },
        };
      },
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    registerRemoteTools(ctx.cwd);
    ctx.ui.setStatus("mewa-host", `host ${remote.config.username}@${remote.config.host}`);
  });

  pi.on("user_bash", (_event, ctx) => ({
    operations: bash,
    cwd: ctx.cwd,
  }));

  pi.on("session_shutdown", async () => {
    remote.close();
  });
}
