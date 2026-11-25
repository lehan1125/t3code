import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTest from "node:test";

NodeTest.test("direct CLI starts the collector", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-collector-cli-"));
  const serverPath = NodeURL.fileURLToPath(new URL("../server.mjs", import.meta.url));
  const child = NodeChildProcess.spawn(process.execPath, [serverPath], {
    cwd: NodePath.dirname(serverPath),
    env: {
      ...process.env,
      T3CODE_COLLECTOR_HOST: "127.0.0.1",
      T3CODE_COLLECTOR_PORT: "0",
      T3CODE_COLLECTOR_DATA_FILE: NodePath.join(dir, "collector.sqlite"),
      T3CODE_COLLECTOR_ANALYTICS_KEY: "cli-test-key",
      T3CODE_COLLECTOR_OTLP_TOKEN: "cli-test-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const line = await new Promise((resolveLine, reject) => {
      child.stdout.once("data", (chunk) => resolveLine(chunk.toString()));
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`collector exited before ready: ${code}`)));
    });
    const address = JSON.parse(line.slice(line.indexOf("{")).trim());
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    NodeAssert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    child.kill();
    if (child.exitCode === null)
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
});
