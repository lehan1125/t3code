import * as NodeZlib from "node:zlib";
import * as NodeCrypto from "node:crypto";
import { storeAnalytics, storeOtlp } from "./storage.mjs";
import { parseJson, validEvent, validOtlpJson, validOtlpProtobuf } from "./payload.mjs";

const BODY_LIMIT = 10 * 1024 * 1024;
const MOBILE_BODY_LIMIT = 2 * 1024 * 1024;
const CONTENT_TYPES = "content-type,authorization";

function matchesSecret(value, expected) {
  if (typeof expected !== "string" || typeof value !== "string" || !expected || !value)
    return false;
  const provided = Buffer.from(value);
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && NodeCrypto.timingSafeEqual(provided, wanted);
}

function authorized(request, expected) {
  const value = request.headers.authorization;
  return (
    typeof value === "string" &&
    value.startsWith("Bearer ") &&
    matchesSecret(value.slice(7), expected)
  );
}

function sendJson(response, options) {
  const { status, value, headers = {} } = options;
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

function readBody(request, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on("end", () =>
      size > limit
        ? reject(Object.assign(new Error("request body too large"), { status: 413 }))
        : resolveBody(Buffer.concat(chunks)),
    );
    request.on("error", reject);
  });
}

function decodeBody(request, body, limit) {
  const encoding = request.headers["content-encoding"];
  if (!encoding || encoding === "identity") return body;
  if (encoding !== "gzip")
    throw Object.assign(new Error("unsupported content encoding"), { status: 415 });
  try {
    const decoded = NodeZlib.gunzipSync(body, { maxOutputLength: limit });
    if (decoded.length > limit)
      throw Object.assign(new Error("request body too large"), { status: 413 });
    return decoded;
  } catch (error) {
    if (error.status) throw error;
    if (error.code === "ERR_BUFFER_TOO_LARGE")
      throw Object.assign(new Error("request body too large"), { status: 413 });
    throw Object.assign(new Error("invalid gzip body"), { status: 400 });
  }
}

function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.origin;
  const corsOrigin = allowedOrigins === "*" ? "*" : allowedOrigins.includes(origin) ? origin : null;
  if (!corsOrigin) return {};
  return {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": CONTENT_TYPES,
    vary: "Origin",
  };
}

function handleHealth(response, cors) {
  sendJson(response, { status: 200, value: { status: "ok" }, headers: cors });
}

async function handleAnalytics(request, response, options) {
  const { db, analyticsKey, cors } = options;
  const body = parseJson(decodeBody(request, await readBody(request, BODY_LIMIT), BODY_LIMIT));
  if (!matchesSecret(body?.api_key, analyticsKey)) {
    sendJson(response, { status: 401, value: { error: "unauthorized" }, headers: cors });
    return;
  }
  if (!Array.isArray(body.batch) || body.batch.some((event) => !validEvent(event))) {
    sendJson(response, { status: 400, value: { error: "invalid batch" }, headers: cors });
    return;
  }
  storeAnalytics(db, body.batch);
  sendJson(response, { status: 200, value: {}, headers: cors });
}

function matchOtlpRoute(path, mobileProjectId) {
  const mobileMatch =
    mobileProjectId && path.match(/^\/v1\/mobile\/observe\/([^/]+)\/v1\/(logs|metrics|traces)$/);
  const genericMatch = path.match(/^\/v1\/(logs|metrics|traces)$/);
  const signal = mobileMatch?.[2] ?? genericMatch?.[1];
  if (!signal || (mobileMatch && mobileMatch[1] !== mobileProjectId)) return null;
  return { signal, isMobile: Boolean(mobileMatch) };
}

function responseEncoding(request, body, signal) {
  const contentType = request.headers["content-type"]?.split(";")[0].trim();
  if (contentType === "application/x-protobuf") {
    validOtlpProtobuf(body);
    return "protobuf";
  }
  if (contentType !== "application/json")
    throw Object.assign(new Error("unsupported content type"), { status: 415 });
  if (!validOtlpJson(parseJson(body), signal))
    throw Object.assign(new Error("invalid OTLP JSON"), { status: 400 });
  return "json";
}

async function handleOtlp(request, response, options) {
  const { db, otlpToken, mobileProjectId, path, cors } = options;
  const route = matchOtlpRoute(path, mobileProjectId);
  if (!route) {
    sendJson(response, { status: 404, value: { error: "not found" }, headers: cors });
    return;
  }
  if (!route.isMobile && !authorized(request, otlpToken)) {
    sendJson(response, { status: 401, value: { error: "unauthorized" }, headers: cors });
    return;
  }
  const limit = route.isMobile ? MOBILE_BODY_LIMIT : BODY_LIMIT;
  const body = decodeBody(request, await readBody(request, limit), limit);
  const encoding = responseEncoding(request, body, route.signal);
  storeOtlp({ db, signal: route.signal, encoding, body });
  response.writeHead(200, {
    ...cors,
    "content-type": encoding === "protobuf" ? "application/x-protobuf" : "application/json",
  });
  response.end(encoding === "protobuf" ? Buffer.alloc(0) : "{}");
}

async function handleRequest(request, response, options) {
  const cors = corsHeaders(request, options.allowedOrigins);
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    response.end();
    return;
  }
  const path = new URL(request.url, "http://localhost").pathname;
  if (request.method === "GET" && path === "/healthz") return handleHealth(response, cors);
  if (request.method !== "POST")
    return sendJson(response, { status: 404, value: { error: "not found" }, headers: cors });
  if (path === "/batch" || path === "/batch/") {
    return handleAnalytics(request, response, { ...options, cors });
  }
  return handleOtlp(request, response, { ...options, path, cors });
}

export function createHandler(options) {
  return async (request, response) => {
    try {
      await handleRequest(request, response, options);
    } catch (error) {
      if (response.headersSent) return;
      if (!error.status)
        console.error("telemetry collector request failure", error.code ?? error.name ?? "Error");
      sendJson(response, {
        status: error.status ?? 500,
        value: { error: error.status ? error.message : "storage failure" },
        headers: corsHeaders(request, options.allowedOrigins),
      });
    }
  };
}
