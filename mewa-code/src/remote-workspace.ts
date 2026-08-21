import { readFile } from "node:fs/promises";
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from "ssh2";

export type ExecResult = {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
};

export type RemoteWorkspaceConfig = {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  expectedHostKeyBase64: string;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
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
  };
}

export class RemoteWorkspace {
  #client: Client | undefined;
  #sftp: SFTPWrapper | undefined;
  #connecting: Promise<void> | undefined;

  constructor(readonly config: RemoteWorkspaceConfig) {}

  static fromEnv(): RemoteWorkspace {
    return new RemoteWorkspace(envConfig());
  }

  async connect(): Promise<void> {
    if (this.#client) return;
    if (this.#connecting) return this.#connecting;
    this.#connecting = (async () => {
      const privateKey = await readFile(this.config.privateKeyPath);
      const client = new Client();
      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        privateKey,
        readyTimeout: 15_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        hostVerifier: (key) => Buffer.from(key).toString("base64") === this.config.expectedHostKeyBase64,
      };
      await new Promise<void>((resolve, reject) => {
        client.once("ready", resolve);
        client.once("error", reject);
        client.connect(connectConfig);
      });
      this.#client = client;
      this.#sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)));
      });
      client.once("close", () => {
        this.#client = undefined;
        this.#sftp = undefined;
      });
    })().finally(() => {
      this.#connecting = undefined;
    });
    return this.#connecting;
  }

  async readFile(path: string): Promise<Buffer> {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.#sftp!.readFile(path, (error, data) => (error ? reject(error) : resolve(Buffer.from(data))));
    });
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    await this.connect();
    await new Promise<void>((resolve, reject) => {
      this.#sftp!.writeFile(path, content, (error) => (error ? reject(error) : resolve()));
    });
  }

  async access(path: string): Promise<void> {
    await this.connect();
    await new Promise<void>((resolve, reject) => {
      this.#sftp!.stat(path, (error) => (error ? reject(error) : resolve()));
    });
  }

  async exec(command: string, cwd: string, signal?: AbortSignal, onData?: (data: Buffer) => void): Promise<ExecResult> {
    await this.connect();
    const remoteCommand = `cd -- ${shellQuote(cwd)} && ${command}`;
    return new Promise<ExecResult>((resolve, reject) => {
      this.#client!.exec(remoteCommand, (error, channel) => {
        if (error) return reject(error);
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const collect = (target: Buffer[], chunk: Buffer | string) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          target.push(data);
          onData?.(data);
        };
        channel.on("data", (chunk) => collect(stdout, chunk));
        channel.stderr.on("data", (chunk) => collect(stderr, chunk));
        channel.once("error", reject);
        channel.once("close", (code: number | null) => {
          signal?.removeEventListener("abort", abort);
          resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: code });
        });
        const abort = () => channel.close();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    });
  }

  async execText(command: string, cwd = "/"): Promise<string> {
    const result = await this.exec(command, cwd);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `Remote command failed: ${result.exitCode}`);
    return result.stdout.toString();
  }

  close(): void {
    this.#client?.end();
    this.#client = undefined;
    this.#sftp = undefined;
  }
}
