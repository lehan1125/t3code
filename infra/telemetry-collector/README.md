# T3 Code self-hosted telemetry collector

This standalone Node service accepts the fork's PostHog-compatible analytics batches, OTLP/HTTP traces, metrics and logs, and Expo mobile observe uploads. It stores accepted events and request bodies in SQLite and never forwards them to another service.

## Run

Requires Node 24.11 or newer with the built-in `node:sqlite` module (the repository targets Node 26). From this directory:

```sh
T3CODE_COLLECTOR_ANALYTICS_KEY='replace-with-a-long-random-value' \
T3CODE_COLLECTOR_OTLP_TOKEN='replace-with-a-different-long-random-value' \
T3CODE_COLLECTOR_MOBILE_PROJECT_ID='your-EAS-project-id' \
T3CODE_COLLECTOR_ALLOWED_ORIGINS='https://app.example.com,https://connect.example.com' \
T3CODE_COLLECTOR_HOST='127.0.0.1' \
T3CODE_COLLECTOR_PORT='4318' \
T3CODE_COLLECTOR_DATA_FILE='./data/telemetry.sqlite' \
node server.mjs
```

Put a TLS reverse proxy in front for remote clients. The default listen address is loopback. The SQLite parent directory is created as needed; keep the data file on durable storage and include it in the operator's backup plan. Do not expose this service publicly without TLS and strong ingest secrets.

- `T3CODE_COLLECTOR_ANALYTICS_KEY` must match the fork's private analytics key (`api_key` in each `/batch` payload). Analytics events commit as one transaction; `uuid` is unique, so retried batches do not duplicate stored events.
- `T3CODE_COLLECTOR_OTLP_TOKEN` is sent as `Authorization: Bearer …` by generic OTLP clients. A collector URL configured in a browser/mobile bundle should be considered public: the mobile observe route intentionally has no auth because expo-observe 58.0.19 sends none. The endpoint accepts writes only and never exposes stored telemetry.
- `T3CODE_COLLECTOR_MOBILE_PROJECT_ID` enables `/v1/mobile/observe/<project-id>/v1/{logs,metrics,traces}`. Requests must name the exact configured project ID and are capped at 2 MiB.
- `T3CODE_COLLECTOR_ALLOWED_ORIGINS` is a comma-separated browser origin allowlist. `*` is the default. Preflight allows `Content-Type` and `Authorization`.

Analytics and generic OTLP requests are capped at 10 MiB. OTLP accepts JSON and protobuf bodies, plus gzip content encoding, and persists the original decoded request body tagged by signal and encoding. `/healthz` returns `{"status":"ok"}`. JSON envelopes must match the route signal and contain only object records; an empty `{}` export is accepted. Protobuf validation checks field framing and length-delimited top-level Resource* records plus framing inside each immediate record; it does not decode the full OTLP schema. Invalid framing is rejected before storage. New SQLite databases and WAL side files are created with owner-only permissions; permissions on an existing database are left untouched. Storage failures return a generic response and log only an error code or class, never a request body. Successful ingest responses are sent only after SQLite commit.

## Inspect stored data

Use the SQLite CLI or another read-only SQLite client:

```sql
SELECT received_at, uuid, event_json FROM analytics ORDER BY received_at;
SELECT received_at, signal, encoding, length(body) AS bytes FROM otlp ORDER BY id;
```

`analytics.event_json` holds the event as received. `otlp.body` is a BLOB containing the payload bytes (gzip is decoded first). Ingest keys, request headers, and client IP addresses are not stored.

## Test

```sh
node --test test/*.test.mjs
```
