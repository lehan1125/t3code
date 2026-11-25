import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

function ensurePrivateFile(path) {
  try {
    const fd = NodeFS.openSync(path, "wx", 0o600);
    NodeFS.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return false;
  }
}

export function openStore(path) {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true, mode: 0o700 });
  const createdSidecars = ["-wal", "-shm"].map((suffix) => [
    `${path}${suffix}`,
    ensurePrivateFile(`${path}${suffix}`),
  ]);
  ensurePrivateFile(path);
  const db = new NodeSqlite.DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS analytics (uuid TEXT PRIMARY KEY, event_json TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))); CREATE TABLE IF NOT EXISTS otlp (id INTEGER PRIMARY KEY, signal TEXT NOT NULL, encoding TEXT NOT NULL, body BLOB NOT NULL, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  // SQLite copies the database mode to newly created WAL sidecars; restore their private mode only when this start created them.
  for (const [sidecar, created] of createdSidecars) {
    if (!created) continue;
    NodeFS.chmodSync(sidecar, 0o600);
  }
  return db;
}

export function storeAnalytics(db, events) {
  const insert = db.prepare("INSERT OR IGNORE INTO analytics (uuid, event_json) VALUES (?, ?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const event of events) insert.run(event.uuid, JSON.stringify(event));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function storeOtlp(options) {
  const { db, signal, encoding, body } = options;
  db.prepare("INSERT INTO otlp (signal, encoding, body) VALUES (?, ?, ?)").run(
    signal,
    encoding,
    body,
  );
}
