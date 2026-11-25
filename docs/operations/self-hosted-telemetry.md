# Self-hosted telemetry

The fork uses `T3CODE_TELEMETRY_URL` for its own telemetry. It accepts an HTTPS origin, for
example `https://telemetry.example.com`. Loopback HTTP is available for local tests. A build
without a collector address has remote telemetry disabled.

## Collector

Run the [collector](../../infra/telemetry-collector/README.md) on your server behind an HTTPS
reverse proxy with persistent storage for its SQLite database. Forward these paths to it.

| Path                                                            | Data                                      | Collector setting                    |
| --------------------------------------------------------------- | ----------------------------------------- | ------------------------------------ |
| `POST /batch/`                                                  | Product usage and approved agent feedback | `T3CODE_COLLECTOR_ANALYTICS_KEY`     |
| `POST /v1/traces`, `/v1/metrics`, `/v1/logs`                    | OTLP telemetry                            | `T3CODE_COLLECTOR_OTLP_TOKEN`        |
| `POST /v1/mobile/observe/<project-id>/v1/{traces,metrics,logs}` | Native iOS and Android diagnostics        | `T3CODE_COLLECTOR_MOBILE_PROJECT_ID` |
| `GET /healthz`                                                  | Listener health                           |                                      |

Mobile Observe requests use an Expo project ID in the path and carry no credentials. The project
ID is public. Configure the reverse proxy's access and rate limits for this write-only endpoint.
For a browser deployment, include its web origin in `T3CODE_COLLECTOR_ALLOWED_ORIGINS`.

## Server, desktop, and browser

Set these variables in the T3 Code environment server's runtime. The two keys match the
corresponding collector settings.

```dotenv
T3CODE_TELEMETRY_URL=https://telemetry.example.com
T3CODE_TELEMETRY_ANALYTICS_KEY=<private analytics key>
T3CODE_TELEMETRY_OTLP_TOKEN=<write-only OTLP token>
```

Keep the analytics key in the server's environment. The desktop launcher can read runtime
variables from your shell profile. Put the URL and OTLP token in the launch environment when
you need server tracing on the first run. Restart T3 Code after making runtime changes. The
existing telemetry opt-out and managed policy still apply.
For a test using the repository's development runner, explicitly set
`T3CODE_TELEMETRY_ENABLED=true`. The development runner opts out by default.

For web and desktop builds, provide the URL and OTLP token at build time. The release workflows
read `vars.T3CODE_TELEMETRY_URL` and `secrets.T3CODE_TELEMETRY_OTLP_TOKEN`. Browser and mobile
bundles can expose this token, so give it only permission to write telemetry. Keep the analytics
key out of build variables and bundles.

## Mobile

Set the collector URL and OTLP token in the environment used to build the fork's mobile app,
including the EAS preview and production environments you use for native builds and OTA
updates. Set `T3CODE_COLLECTOR_MOBILE_PROJECT_ID` on the collector to the app's Expo project
ID. Build and install the fork and verify the address on a cold start. Native diagnostics and
connection tracing retain their separate switches under **Settings → About T3 Code → Diagnostics**.

Set `T3CODE_MOBILE_EAS_PROJECT_ID` and `T3CODE_MOBILE_EAS_OWNER` to use your own EAS project
for fork releases. OTA updates are disabled when the project ID is unset. Set
`T3CODE_MOBILE_UPDATES_ENABLED=0` to disable them for an explicitly configured project too.

## T3 Connect relay

`T3CODE_RELAY_URL` is the address for T3 Connect account, pairing, tunnel, and notification
traffic. Keep your chosen T3 Connect address there. The collector receives diagnostics at
`T3CODE_TELEMETRY_URL`.

If you deploy the fork's relay, pass the collector origin and OTLP token into the relay
deployment too. The relay sends its own operational traces and forwards older mobile clients'
diagnostics to the configured collector. Current fork mobile builds send native diagnostics
directly to the collector. Direct ingestion stores the payload as delivered by the app and
does not symbolicate JavaScript stacks.

The hosted T3 Connect service controls its own operational logs. Changing the fork's collector
does not change how the hosted service records the functional requests it handles. User-configured
OpenTelemetry export under **Settings → Maintenance → Diagnostics** retains its own destination.

Build-cache telemetry has a separate opt-in setup. If you previously installed the shared
task-cache hook on your workstation, `T3_TASK_CACHE_TELEMETRY=off` disables task summaries for
builds that still use that hook.
