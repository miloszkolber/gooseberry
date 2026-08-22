import assert from "node:assert/strict";

const extensionPath =
  process.env.MEWA_REMOTE_EXTENSION ?? "/opt/synara/mewa/dist/pi/extensions/mewa-remote.js";
const cwd = process.env.MEWA_SMOKE_CWD ?? "/repo/smoke";

const tools = new Map();
const handlers = new Map();

const pi = {
  registerTool(tool) {
    tools.set(tool.name, tool);
  },
  on(event, handler) {
    handlers.set(event, handler);
  },
};

const { default: mewaRemote } = await import(extensionPath);
mewaRemote(pi);

const sessionStart = handlers.get("session_start");
assert.equal(typeof sessionStart, "function", "mewa-remote must register session_start");
await sessionStart(
  {},
  {
    cwd,
    ui: {
      setStatus() {},
    },
  },
);

for (const name of ["read", "write", "edit", "ls", "find", "bash", "grep"]) {
  assert.ok(tools.has(name), `mewa-remote must register Pi tool: ${name}`);
}

const write = tools.get("write");
const read = tools.get("read");
const bash = tools.get("bash");
const grep = tools.get("grep");

await write.execute("write-mounted", {
  path: "mounted.txt",
  content: "mounted-ok\n",
});
const mountedRead = await read.execute("read-mounted", { path: "mounted.txt" });
assert.match(textContent(mountedRead), /mounted-ok/);

const mountedBash = await bash.execute("bash-mounted", {
  command: "test \"$(cat mounted.txt)\" = mounted-ok && printf 'mounted-bash-ok\\n'",
  timeout: 10,
});
assert.match(textContent(mountedBash), /mounted-bash-ok/);

const mountedGrep = await grep.execute("grep-mounted", {
  pattern: "mounted-ok",
  path: ".",
  literal: true,
  limit: 20,
});
assert.match(textContent(mountedGrep), /mounted\.txt/);

await write.execute("write-sftp", {
  path: "~/sftp-smoke.txt",
  content: "sftp-ok\n",
});
const sftpRead = await read.execute("read-sftp", { path: "~/sftp-smoke.txt" });
assert.match(textContent(sftpRead), /sftp-ok/);

const sftpBash = await bash.execute("bash-sftp", {
  command: "test \"$(cat ~/sftp-smoke.txt)\" = sftp-ok && printf 'sftp-bash-ok\\n'",
  timeout: 10,
});
assert.match(textContent(sftpBash), /sftp-bash-ok/);

const shutdown = handlers.get("session_shutdown");
if (typeof shutdown === "function") await shutdown();

console.log("Pi remote tool smoke passed: mounted files, SFTP fallback, SSH bash, and host grep.");

function textContent(result) {
  return (result?.content ?? [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}
