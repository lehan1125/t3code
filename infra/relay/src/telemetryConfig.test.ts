import { describe, expect, it } from "vite-plus/test";
import * as Redacted from "effect/Redacted";

import { resolveTelemetryConfig } from "./telemetryConfig.ts";

describe("resolveTelemetryConfig", () => {
  it("leaves telemetry unconfigured when both values are unset or blank", () => {
    expect(resolveTelemetryConfig(undefined, undefined)).toBeUndefined();
    expect(resolveTelemetryConfig(" ", Redacted.make(" "))).toBeUndefined();
  });

  it("rejects a partial collector configuration", () => {
    expect(() => resolveTelemetryConfig("https://collector.example.test", undefined)).toThrow(
      "Configure both T3CODE_TELEMETRY_URL and T3CODE_TELEMETRY_OTLP_TOKEN",
    );
  });

  it("requires an HTTPS or loopback HTTP origin and a nonempty token", () => {
    expect(() =>
      resolveTelemetryConfig("https://collector.example.test/v1", Redacted.make("x")),
    ).toThrow("T3CODE_TELEMETRY_URL must be an HTTPS origin or HTTP loopback origin");
  });

  it("normalizes the origin and trims the token", () => {
    const config = resolveTelemetryConfig(
      " https://collector.example.test/ ",
      Redacted.make(" token "),
    );
    expect(config?.origin).toBe("https://collector.example.test");
    expect(config && Redacted.value(config.token)).toBe("token");
  });
});
