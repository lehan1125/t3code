# Relay observability

The fork's relay exports runtime traces to the [self-hosted collector](./self-hosted-telemetry.md).
The Alchemy stack still provisions the existing Axiom datasets and dashboards and the
`t3-code-mobile-sourcemaps-<stage>` R2 bucket.

The Axiom queries below apply to deployments that previously sent data there. For this
fork's current traces, query the collector's SQLite database.

## Alerts

Threshold monitors in [`infra/relay/src/monitoring.ts`](../../infra/relay/src/monitoring.ts) activate when `RELAY_ALERT_NOTIFIER_ID` is set (optional warnings go to `RELAY_WARNING_NOTIFIER_ID`). Monitors count HTTP status codes, not span errors—a 9 s relay timeout returns 504 even without a span error flag, and `/connect` 502s are normal for offline hosts.

- **Links / tunnel recovery failing / Cloudflare 429s:** Check "Link failures by reason" and Cloudflare API status on `t3-code-relay-health`. Sustained 429s indicate Cloudflare API rate limiting or a recovery loop; slow Postgres points at DB/Hyperdrive.
- **Environments unreachable:** Check Cloudflare Tunnel status and recent relay deploys before blaming hosts.
- **Push delivery failing:** Inspect `relay.apns_deliveries.process_signed_job` or `relay.fcm.process` errors—an expired APNs key or FCM service account fails every job.
- **Traffic dropped:** Check `https://relay.t3.codes/health` first.
- **Tunnel cleanup stopped / deletions failing:** Check `relay.managed_endpoint_reaper.sweep` spans and Cloudflare API errors. To pause cleanup during an incident, set `RELAY_TUNNEL_CLEANUP_MODE=off` and redeploy the relay (see [Managed tunnel cleanup rollout](./03_release.md#managed-tunnel-cleanup-rollout)).
- **Account deletions failing:** A Clerk account deletion keeps failing. `select * from relay_account_deletions where completed_at is null order by attempts desc` shows which, and the failed `relay.account_deletion.delete_account` span under each `relay.account_deletion.process_pending` sweep names the stage (usually Cloudflare tunnel teardown). The row stays and retries every 5 minutes until it succeeds.

## Mobile crashes and errors

Current mobile builds send `expo-observe` logs, metrics, and spans directly to the collector.
For older clients still using the relay's `/v1/mobile/observe` endpoint, the relay symbolicates
Hermes JS stacks with source maps from R2 before forwarding the report to the configured
collector. `relay.symbolication.status` records the outcome.

- **Counting real native crashes:** Fatal JS errors also trigger a native abort; filter out `relay.crash.js_fatal` (and Android OS `SIGKILL`s, which indicate memory pressure/swiping) when counting native crashes:

  ```apl
  ['t3-code-mobile-logs-prod']
  | where ['attributes.expo.error.source'] == 'nativeCrash'
  | where isnull(['attributes.relay.crash.js_fatal'])
  | summarize count() by ['attributes.exception.type'], ['attributes.exception.message']
  ```

- **Symbolicating iOS native crashes:** Download the build's dSYM archive from R2 at `ios/dsym/<easBuildId>.zip` and resolve offsets (`T3Code + <offset>`):

  ```sh
  unzip <easBuildId>.zip
  atos -arch arm64 -o T3Code.app.dSYM/Contents/Resources/DWARF/T3Code -l 0x100000000 \
    $(printf '0x%x' $((0x100000000 + <offset>)))
  ```

- **Source map upload secret:** `MOBILE_SOURCEMAPS_R2` comes from Alchemy output `mobileSourceMapsUploadCredentials` (`cd infra/relay && vp exec alchemy state read T3CodeRelay/prod/output`). Store it as a GitHub Actions secret (for OTA updates) and as an EAS `production`-only secret (never `preview`, which runs PR code).
- **Mobile alerts ([`infra/relay/src/mobileTelemetry/monitoring.ts`](../../infra/relay/src/mobileTelemetry/monitoring.ts)):** Crash spikes right after a release usually indicate a bad OTA—roll back in EAS. Android OS-kill spikes lag releases and point to memory leaks or main-thread freezes.
