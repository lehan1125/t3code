import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import { createHandler } from "./http.mjs";
import { openStore } from "./storage.mjs";

export function startCollector(options = {}) {
  const settings = {
    host: options.host ?? process.env.T3CODE_COLLECTOR_HOST ?? "127.0.0.1",
    port: Number(options.port ?? process.env.T3CODE_COLLECTOR_PORT ?? 4318),
    dataFile: NodePath.resolve(
      options.dataFile ?? process.env.T3CODE_COLLECTOR_DATA_FILE ?? "./data/telemetry.sqlite",
    ),
    analyticsKey: options.analyticsKey ?? process.env.T3CODE_COLLECTOR_ANALYTICS_KEY,
    otlpToken: options.otlpToken ?? process.env.T3CODE_COLLECTOR_OTLP_TOKEN,
    mobileProjectId: options.mobileProjectId ?? process.env.T3CODE_COLLECTOR_MOBILE_PROJECT_ID,
    allowedOrigins: (options.allowedOrigins ?? process.env.T3CODE_COLLECTOR_ALLOWED_ORIGINS ?? "*")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
  if (!Number.isInteger(settings.port) || settings.port < 0 || settings.port > 65535)
    throw new Error("invalid T3CODE_COLLECTOR_PORT");
  const db = openStore(settings.dataFile);
  const server = NodeHttp.createServer(
    createHandler({
      ...settings,
      db,
      allowedOrigins: settings.allowedOrigins.includes("*") ? "*" : settings.allowedOrigins,
    }),
  );
  server.on("close", () => db.close());
  server.listen(settings.port, settings.host);
  return server;
}

if (import.meta.main) {
  const server = startCollector();
  server.on("listening", () =>
    console.log(`telemetry collector listening on ${JSON.stringify(server.address())}`),
  );
  server.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
