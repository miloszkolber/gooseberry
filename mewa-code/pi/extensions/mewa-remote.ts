import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type BashOperations,
  type EditOperations,
  type ExtensionAPI,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { RemoteWorkspace } from "../../src/remote-workspace.js";

/**
 * Replace Pi's core coding tools with definitions that preserve Pi's native
 * schemas/renderers while delegating I/O and execution to the SSH host.
 * SSH remains invisible to the model.
 */
export default function mewaRemote(pi: ExtensionAPI) {
  const remote = RemoteWorkspace.fromEnv();

  const read: ReadOperations = {
    readFile: (path) => remote.readFile(path),
    access: (path) => remote.access(path),
  };

  const write: WriteOperations = {
    writeFile: (path, content) => remote.writeFile(path, content),
    mkdir: async (dir) => {
      await remote.execText(`mkdir -p -- ${quote(dir)}`);
    },
  };

  const edit: EditOperations = {
    readFile: (path) => remote.readFile(path),
    writeFile: (path, content) => remote.writeFile(path, content),
    access: (path) => remote.access(path),
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
        const result = await remote.exec(command, cwd, controller.signal, execution.onData);
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

  // These use Pi's own schemas, renderers, diffs and truncation behavior.
  pi.registerTool(createReadToolDefinition("/", { operations: read }));
  pi.registerTool(createWriteToolDefinition("/", { operations: write }));
  pi.registerTool(createEditToolDefinition("/", { operations: edit }));
  pi.registerTool(createBashToolDefinition("/", { operations: bash }));

  pi.on("session_shutdown", async () => {
    remote.close();
  });
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
