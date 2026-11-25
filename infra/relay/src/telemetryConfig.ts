import * as Redacted from "effect/Redacted";

import { telemetryOrigin } from "@t3tools/shared/telemetryEndpoint";

export interface CollectorTelemetryConfig {
  readonly origin: string;
  readonly token: Redacted.Redacted<string>;
}

export function resolveTelemetryConfig(
  url: string | undefined,
  token: Redacted.Redacted<string> | undefined,
): CollectorTelemetryConfig | undefined {
  const configuredUrl = url?.trim() || undefined;
  const tokenValue = token === undefined ? "" : Redacted.value(token).trim();
  const configuredToken = tokenValue.length > 0 ? Redacted.make(tokenValue) : undefined;
  if ((configuredUrl === undefined) !== (configuredToken === undefined)) {
    throw new Error("Configure both T3CODE_TELEMETRY_URL and T3CODE_TELEMETRY_OTLP_TOKEN");
  }
  if (configuredUrl === undefined || configuredToken === undefined) return undefined;
  const origin = telemetryOrigin(configuredUrl);
  if (origin === null) {
    throw new Error("T3CODE_TELEMETRY_URL must be an HTTPS origin or HTTP loopback origin");
  }
  return { origin, token: configuredToken };
}
