import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeSqlite from "node:sqlite";
import * as NodeZlib from "node:zlib";
import { startCollector } from "../server.mjs";

const requestJson = (url, body, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function withCollector(run) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-collector-"));
  const dataFile = NodePath.join(dir, "collector.sqlite");
  const server = startCollector({
    host: "127.0.0.1",
    port: 0,
    dataFile,
    analyticsKey: "analytics-test-key",
    otlpToken: "otlp-test-token",
    mobileProjectId: "project-123",
    allowedOrigins: "https://app.example.test",
  });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`, dataFile);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
}

NodeTest.test("health and browser preflight return CORS headers", async () =>
  withCollector(async (base) => {
    const health = await fetch(`${base}/healthz`);
    NodeAssert.deepEqual(await health.json(), { status: "ok" });
    const preflight = await fetch(`${base}/v1/logs`, {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.test",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    NodeAssert.equal(preflight.status, 204);
    NodeAssert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://app.example.test",
    );
    NodeAssert.equal(
      preflight.headers.get("access-control-allow-headers"),
      "content-type,authorization",
    );
  }),
);

NodeTest.test("analytics auth, transaction persistence, and UUID retry deduplication", async () =>
  withCollector(async (base, dataFile) => {
    const event = {
      uuid: "event-1",
      event: "opened",
      distinct_id: "user-1",
      properties: { surface: "web" },
      timestamp: "2026-11-25T00:00:00Z",
    };
    NodeAssert.equal(
      (await requestJson(`${base}/batch/`, { api_key: "wrong", batch: [event] })).status,
      401,
    );
    const payload = { api_key: "analytics-test-key", batch: [event, event] };
    NodeAssert.equal((await requestJson(`${base}/batch`, payload)).status, 200);
    NodeAssert.equal((await requestJson(`${base}/batch/`, payload)).status, 200);
    NodeAssert.equal(
      (
        await requestJson(`${base}/batch/`, {
          api_key: "analytics-test-key",
          batch: [{ ...event, uuid: "" }],
        })
      ).status,
      400,
    );
    const db = new NodeSqlite.DatabaseSync(dataFile);
    NodeAssert.equal(db.prepare("SELECT count(*) AS n FROM analytics").get().n, 1);
    NodeAssert.equal(
      JSON.parse(db.prepare("SELECT event_json FROM analytics").get().event_json).event,
      "opened",
    );
    db.close();
  }),
);

NodeTest.test("OTLP routes authenticate generic JSON and persist protobuf bytes", async () =>
  withCollector(async (base, dataFile) => {
    const payload = { resourceLogs: [] };
    NodeAssert.equal((await requestJson(`${base}/v1/logs`, payload)).status, 401);
    NodeAssert.equal(
      (
        await requestJson(
          `${base}/v1/logs`,
          { resourceLogs: [null, 42, "garbage"] },
          { authorization: "Bearer otlp-test-token" },
        )
      ).status,
      400,
    );
    NodeAssert.equal(
      (
        await requestJson(
          `${base}/v1/logs`,
          { resourceTraces: [] },
          { authorization: "Bearer otlp-test-token" },
        )
      ).status,
      400,
    );
    const emptyExport = await requestJson(
      `${base}/v1/logs`,
      {},
      { authorization: "Bearer otlp-test-token" },
    );
    NodeAssert.equal(emptyExport.status, 200);
    const response = await requestJson(`${base}/v1/logs`, payload, {
      authorization: "Bearer otlp-test-token",
    });
    NodeAssert.equal(response.status, 200);
    NodeAssert.deepEqual(await response.json(), {});
    const compressed = await fetch(`${base}/v1/logs`, {
      method: "POST",
      headers: {
        authorization: "Bearer otlp-test-token",
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: NodeZlib.gzipSync(Buffer.from(JSON.stringify(payload))),
    });
    NodeAssert.equal(compressed.status, 200);
    const unsupported = await fetch(`${base}/v1/logs`, {
      method: "POST",
      headers: {
        authorization: "Bearer otlp-test-token",
        "content-type": "application/json",
        "content-encoding": "br",
      },
      body: "{}",
    });
    NodeAssert.equal(unsupported.status, 415);
    const proto = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: {
        authorization: "Bearer otlp-test-token",
        "content-type": "application/x-protobuf",
      },
      body: Buffer.from([10, 0]),
    });
    NodeAssert.equal(proto.status, 200);
    NodeAssert.equal((await proto.arrayBuffer()).byteLength, 0);
    const emptyProto = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: {
        authorization: "Bearer otlp-test-token",
        "content-type": "application/x-protobuf",
      },
      body: Buffer.alloc(0),
    });
    NodeAssert.equal(emptyProto.status, 200);
    for (const malformed of [[0xff], [0x0a, 0x02, 0x08], [0x0a, 0x01, 0xff]]) {
      const rejected = await fetch(`${base}/v1/traces`, {
        method: "POST",
        headers: {
          authorization: "Bearer otlp-test-token",
          "content-type": "application/x-protobuf",
        },
        body: Buffer.from(malformed),
      });
      NodeAssert.equal(rejected.status, 400);
    }
    const db = new NodeSqlite.DatabaseSync(dataFile);
    NodeAssert.equal(db.prepare("SELECT count(*) AS n FROM otlp").get().n, 5);
    NodeAssert.deepEqual(
      db
        .prepare("SELECT signal, encoding, body FROM otlp ORDER BY id")
        .all()
        .map((row) => [row.signal, row.encoding, Buffer.from(row.body)]),
      [
        ["logs", "json", Buffer.from("{}")],
        ["logs", "json", Buffer.from(JSON.stringify(payload))],
        ["logs", "json", Buffer.from(JSON.stringify(payload))],
        ["traces", "protobuf", Buffer.from([10, 0])],
        ["traces", "protobuf", Buffer.alloc(0)],
      ],
    );
    db.close();
  }),
);

NodeTest.test(
  "mobile observe routes are project scoped, unauthenticated, and capped at 2 MiB",
  async () =>
    withCollector(async (base, dataFile) => {
      const endpoint = `${base}/v1/mobile/observe/project-123/v1/metrics`;
      const accepted = await requestJson(endpoint, { resourceMetrics: [] });
      NodeAssert.equal(accepted.status, 200);
      NodeAssert.equal(
        (await requestJson(`${base}/v1/mobile/observe/other/v1/metrics`, { resourceMetrics: [] }))
          .status,
        404,
      );
      const oversized = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: Buffer.alloc(2 * 1024 * 1024 + 1),
      });
      NodeAssert.equal(oversized.status, 413);
      const compressedOversized = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
        body: NodeZlib.gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1)),
      });
      NodeAssert.equal(compressedOversized.status, 413);
      const db = new NodeSqlite.DatabaseSync(dataFile);
      NodeAssert.equal(db.prepare("SELECT count(*) AS n FROM otlp").get().n, 1);
      db.close();
    }),
);

NodeTest.test(
  "new databases are private and existing database permissions are preserved",
  async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-collector-mode-"));
    const dataFile = NodePath.join(dir, "existing.sqlite");
    const existing = new NodeSqlite.DatabaseSync(dataFile);
    existing.exec("CREATE TABLE existing_value (value TEXT)");
    existing.close();
    await NodeFSP.chmod(dataFile, 0o640);
    const server = startCollector({
      host: "127.0.0.1",
      port: 0,
      dataFile,
      otlpToken: "existing-store-test",
    });
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    try {
      NodeAssert.equal((await NodeFSP.stat(dataFile)).mode & 0o777, 0o640);
      const response = await requestJson(
        `http://127.0.0.1:${server.address().port}/v1/logs`,
        { resourceLogs: [] },
        { authorization: "Bearer existing-store-test" },
      );
      NodeAssert.equal(response.status, 200);
      for (const path of [`${dataFile}-wal`, `${dataFile}-shm`]) {
        NodeAssert.equal((await NodeFSP.stat(path)).mode & 0o777, 0o600);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
    await withCollector(async (base, freshFile) => {
      await requestJson(`${base}/v1/mobile/observe/project-123/v1/logs`, { resourceLogs: [] });
      for (const path of [freshFile, `${freshFile}-wal`, `${freshFile}-shm`]) {
        NodeAssert.equal((await NodeFSP.stat(path)).mode & 0o777, 0o600);
      }
    });
  },
);

NodeTest.test("unexpected storage failures log only safe diagnostics", async () =>
  withCollector(async (base, dataFile) => {
    const db = new NodeSqlite.DatabaseSync(dataFile);
    db.exec("DROP TABLE otlp");
    db.close();
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.join(" "));
    try {
      const response = await requestJson(
        `${base}/v1/logs`,
        { resourceLogs: [{ body: "must-not-be-logged" }] },
        { authorization: "Bearer otlp-test-token" },
      );
      NodeAssert.equal(response.status, 500);
      NodeAssert.doesNotMatch(await response.text(), /must-not-be-logged/);
    } finally {
      console.error = originalError;
    }
    NodeAssert.equal(logged.length, 1);
    NodeAssert.match(logged[0], /SQLITE_ERROR/);
    NodeAssert.doesNotMatch(logged[0], /must-not-be-logged/);
  }),
);
