import { describe, expect, it } from "@effect/vitest";

import { telemetryEndpoint, telemetryOrigin } from "./telemetryEndpoint.ts";

describe("telemetry collector configuration", () => {
  it.each([
    ["https://collector.example.test", "https://collector.example.test"],
    ["http://localhost:4318", "http://localhost:4318"],
    ["http://127.0.0.1:4318", "http://127.0.0.1:4318"],
  ])("accepts collector origin %s", (value, expected) => {
    expect(telemetryOrigin(value)).toBe(expected);
  });

  it.each([
    "http://collector.example.test",
    "https://collector.example.test/prefix",
    "https://user:pass@collector.example.test",
    "https://collector.example.test?token=secret",
  ])("rejects unsafe collector URL %s", (value) => {
    expect(telemetryOrigin(value)).toBeNull();
  });

  it("appends signal endpoints only to a configured origin", () => {
    expect(telemetryEndpoint("https://collector.example.test", "/v1/traces")).toBe(
      "https://collector.example.test/v1/traces",
    );
    expect(telemetryEndpoint(undefined, "/v1/traces")).toBeNull();
  });
});
