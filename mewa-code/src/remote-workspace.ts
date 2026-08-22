import { constants } from "node:fs";
import {
  access as localAccess,
  lstat as localLstat,
  mkdir as localMkdir,
  readFile as localReadFile,
  readdir as localReaddir,
  realpath as localRealpath,
  stat as localStat,
  writeFile as localWriteFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { posix as remotePath } from "node:path";
import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type SFTPWrapper,
} from "ssh2";

export type ExecResult = {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
};

export type WorkspaceStat = {
  isDirectory(): boolean;
  isFile(): boolean;
};

export type RemoteWorkspaceConfig = {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  expectedHostKeyBase64: string;
  localRoots: string[];
  remoteFallback: boolean;
  shell: string;
  forwardedEnvironment: string[];
  maxOutputBytes: number;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function normalizeRoots(value: string | undefined): string[] {
  const roots = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!isAbsolute(entry)) {
        throw new Error(`MEWA_LOCAL_ROOTS entries must be absolute: ${entry}`);
      }
      const root = normalize(resolve(entry));
      if (root === sep) {
        throw new Error("MEWA_LOCAL_ROOTS must not contain the filesystem root");
      }
      return root;
    });
  return [...new Set(roots)].sort((a, b) => b.length - a.length);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function envConfig(): RemoteWorkspaceConfig {
  const host = process.env.MEWA_SSH_HOST;
  const username = process.env.MEWA_SSH_USER;
  const privateKeyPath = process.env.MEWA_SSH_PRIVATE_KEY;
  const knownHost = process.env.MEWA_SSH_KNOWN_HOST;
  if (!host || !username || !privateKeyPath || !knownHost) {
    throw new Error("Missing MEWA_SSH_HOST/USER/PRIVATE_KEY/KNOWN_HOST");
  }
  const fields = knownHost.trim().split(/\s+/);
  const expectedHostKeyBase64 = fields.at(-1);
  if (!expectedHostKeyBase64) throw new Error("Invalid MEWA_SSH_KNOWN_HOST");
  return {
    host,
    port: Number(process.env.MEWA_SSH_PORT ?? "22"),
    username,
    privateKeyPath,
    expectedHostKeyBase64,
    localRoots: normalizeRoots(process.env.MEWA_LOCAL_ROOTS),
    remoteFallback: parseBoolean(process.env.MEWA_SFTP_FALLBACK, true),
    shell: process.env.MEWA_SSH_SHELL?.trim() || "/bin/bash",
    forwardedEnvironment: (process.env.MEWA_SSH_FORWARD_ENV ??
      "PI_SESSION_ID,PI_PROVIDER,PI_MODEL,PI_REASONING_LEVEL,CI")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    maxOutputBytes: parsePositiveInteger(
      process.env.MEWA_SSH_MAX_OUTPUT_BYTES,
      4 * 1024 * 1024,
    ),
  };
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "ENOENT" || code === "2" || code === "NO_SUCH_FILE";
}

export class RemoteWorkspace {
  #client: Client | undefined;
  #sftp: SFTPWrapper | undefined;
  #connecting: Promise<void> | undefined;

  constructor(readonly config: RemoteWorkspaceConfig) {}

  static fromEnv(): RemoteWorkspace {
    return new RemoteWorkspace(envConfig());
  }

  get localRoots(): readonly string[] {
    return this.config.localRoots;
  }

  async connect(): Promise<void> {
    if (this.#client && this.#sftp) return;
    if (this.#connecting) return this.#connecting;
    this.#connecting = (async () => {
      const privateKey = await localReadFile(this.config.privateKeyPath);
      const client = new Client();
      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        privateKey,
        readyTimeout: 15_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer) =>
          key.toString("base64") === this.config.expectedHostKeyBase64,
      };
      await new Promise<void>((resolveReady, reject) => {
        client.once("ready", resolveReady);
        client.once("error", reject);
        client.connect(connectConfig);
      });
      const sftp = await new Promise<SFTPWrapper>((resolveSftp, reject) => {
        client.sftp((error, wrapper) => (error ? reject(error) : resolveSftp(wrapper)));
      });
      this.#client = client;
      this.#sftp = sftp;
      const reset = () => {
        if (this.#client === client) {
          this.#client = undefined;
          this.#sftp = undefined;
        }
      };
      client.once("close", reset);
      client.once("end", reset);
    })().finally(() => {
      this.#connecting = undefined;
    });
    return this.#connecting;
  }

  #lexicallyMounted(path: string): string | undefined {
    if (!isAbsolute(path)) return undefined;
    const candidate = normalize(resolve(path));
    return this.config.localRoots.some((root) => isWithin(root, candidate))
      ? candidate
      : undefined;
  }

  #realPathMounted(path: string): boolean {
    return this.config.localRoots.some((root) => isWithin(root, path));
  }

  async #localReadPath(path: string): Promise<string | undefined> {
    const candidate = this.#lexicallyMounted(path);
    if (!candidate) return undefined;
    try {
      const resolved = await localRealpath(candidate);
      return this.#realPathMounted(resolved) ? resolved : undefined;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async #nearestExistingAncestor(path: string): Promise<string | undefined> {
    let current = path;
    for (;;) {
      try {
        return await localRealpath(current);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }

  async #localWritePath(path: string): Promise<string | undefined> {
    const candidate = this.#lexicallyMounted(path);
    if (!candidate) return undefined;
    try {
      await localLstat(candidate);
      const resolved = await localRealpath(candidate);
      return this.#realPathMounted(resolved) ? resolved : undefined;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const ancestor = await this.#nearestExistingAncestor(dirname(candidate));
    return ancestor && this.#realPathMounted(ancestor) ? candidate : undefined;
  }

  #requireFallback(path: string): void {
    if (!this.config.remoteFallback) {
      throw new Error(
        `Path is not available through an approved same-path mount: ${path}. ` +
          "Enable MEWA_SFTP_FALLBACK or add its root to MEWA_LOCAL_ROOTS.",
      );
    }
  }

  async readFile(path: string): Promise<Buffer> {
    const local = await this.#localReadPath(path);
    if (local) return localReadFile(local);
    this.#requireFallback(path);
    await this.connect();
    return new Promise((resolveRead, reject) => {
      this.#sftp!.readFile(path, (error, data) =>
        error ? reject(error) : resolveRead(Buffer.from(data)),
      );
    });
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    const local = await this.#localWritePath(path);
    if (local) {
      await localWriteFile(local, content);
      return;
    }
    this.#requireFallback(path);
    await this.connect();
    await new Promise<void>((resolveWrite, reject) => {
      this.#sftp!.writeFile(path, content, (error) =>
        error ? reject(error) : resolveWrite(),
      );
    });
  }

  async mkdir(path: string): Promise<void> {
    const local = await this.#localWritePath(path);
    if (local) {
      await localMkdir(local, { recursive: true });
      return;
    }
    this.#requireFallback(path);
    await this.connect();
    const segments = remotePath.resolve(path).split("/").filter(Boolean);
    let current = "/";
    for (const segment of segments) {
      current = remotePath.join(current, segment);
      try {
        await this.#remoteStat(current);
      } catch (error) {
        if (!isMissing(error)) throw error;
        await new Promise<void>((resolveMkdir, reject) => {
          this.#sftp!.mkdir(current, (mkdirError) =>
            mkdirError ? reject(mkdirError) : resolveMkdir(),
          );
        });
      }
    }
  }

  async access(path: string, mode = constants.R_OK): Promise<void> {
    const local = await this.#localReadPath(path);
    if (local) {
      await localAccess(local, mode);
      return;
    }
    this.#requireFallback(path);
    await this.#remoteStat(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async stat(path: string): Promise<WorkspaceStat> {
    const local = await this.#localReadPath(path);
    if (local) {
      const value = await localStat(local);
      return {
        isDirectory: () => value.isDirectory(),
        isFile: () => value.isFile(),
      };
    }
    this.#requireFallback(path);
    return this.#remoteStat(path);
  }

  async readdir(path: string): Promise<string[]> {
    const local = await this.#localReadPath(path);
    if (local) return localReaddir(local);
    this.#requireFallback(path);
    await this.connect();
    return new Promise((resolveReadDir, reject) => {
      this.#sftp!.readdir(path, (error, entries) =>
        error ? reject(error) : resolveReadDir(entries.map((entry) => entry.filename)),
      );
    });
  }

  async #remoteStat(path: string): Promise<WorkspaceStat> {
    await this.connect();
    return new Promise<WorkspaceStat>((resolveStat, reject) => {
      this.#sftp!.stat(path, (error, value) => {
        if (error) {
          reject(error);
          return;
        }
        resolveStat({
          isDirectory: () => value.isDirectory(),
          isFile: () => value.isFile(),
        });
      });
    });
  }

  async detectImageMimeType(path: string): Promise<string | null> {
    try {
      const output = (
        await this.execText(`file --mime-type -b -- ${shellQuote(path)}`, "/")
      ).trim();
      return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(output)
        ? output
        : null;
    } catch {
      return null;
    }
  }

  async find(
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ): Promise<string[]> {
    const args = [
      "fd",
      "--glob",
      "--color=never",
      "--hidden",
      "--no-require-git",
      "--max-results",
      String(options.limit),
    ];
    for (const ignored of options.ignore) args.push("--exclude", ignored);
    args.push("--", pattern, cwd);
    const output = await this.execText(args.map(shellQuote).join(" "), "/");
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async grep(input: {
    pattern: string;
    path: string;
    glob?: string;
    ignoreCase?: boolean;
    literal?: boolean;
    context?: number;
    limit: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const args = ["rg", "--line-number", "--color=never", "--hidden"];
    if (input.ignoreCase) args.push("--ignore-case");
    if (input.literal) args.push("--fixed-strings");
    if (input.glob) args.push("--glob", input.glob);
    if (input.context && input.context > 0) args.push("--context", String(input.context));
    args.push("--", input.pattern, input.path);
    const script = `${args.map(shellQuote).join(" ")} | head -n ${Math.max(1, input.limit)}`;
    const result = await this.exec(script, "/", input.signal);
    if (result.exitCode !== 0 && result.stdout.length === 0) {
      const message = result.stderr.toString().trim();
      if (message) throw new Error(message);
    }
    return result.stdout.toString().trimEnd() || "No matches found";
  }

  #forwardedEnv(env: NodeJS.ProcessEnv | undefined): string {
    if (!env) return "";
    const assignments: string[] = [];
    for (const name of this.config.forwardedEnvironment) {
      const value = env[name];
      if (value !== undefined) assignments.push(`${name}=${shellQuote(value)}`);
    }
    return assignments.length > 0 ? `${assignments.join(" ")} ` : "";
  }

  async exec(
    command: string,
    cwd: string,
    signal?: AbortSignal,
    onData?: (data: Buffer) => void,
    env?: NodeJS.ProcessEnv,
  ): Promise<ExecResult> {
    await this.connect();
    const script = `${this.#forwardedEnv(env)}cd -- ${shellQuote(cwd)} && ${command}`;
    const remoteCommand = `${shellQuote(this.config.shell)} -lc ${shellQuote(script)}`;
    return new Promise<ExecResult>((resolveExec, reject) => {
      this.#client!.exec(remoteCommand, (error, channel) => {
        if (error) return reject(error);
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let total = 0;
        let settled = false;
        const finishError = (cause: Error) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", abort);
          channel.close();
          reject(cause);
        };
        const collect = (target: Buffer[], chunk: Buffer | string) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += data.length;
          if (total > this.config.maxOutputBytes) {
            finishError(
              new Error(`Remote command output exceeded ${this.config.maxOutputBytes} bytes`),
            );
            return;
          }
          target.push(data);
          onData?.(data);
        };
        channel.on("data", (chunk: Buffer | string) => collect(stdout, chunk));
        channel.stderr.on("data", (chunk: Buffer | string) => collect(stderr, chunk));
        channel.once("error", (cause: Error) => finishError(cause));
        channel.once("close", (code: number | null) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", abort);
          resolveExec({
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
            exitCode: code,
          });
        });
        const abort = () => {
          try {
            (channel as ClientChannel).signal("TERM");
          } catch {
            // Closing the SSH channel is the final cancellation boundary.
          }
          channel.close();
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    });
  }

  async execText(command: string, cwd = "/"): Promise<string> {
    const result = await this.exec(command, cwd);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString() || `Remote command failed: ${result.exitCode}`);
    }
    return result.stdout.toString();
  }

  close(): void {
    this.#client?.end();
    this.#client = undefined;
    this.#sftp = undefined;
  }
}
