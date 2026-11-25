import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    T3CODE_TELEMETRY_URL: process.env.T3CODE_TELEMETRY_URL,
    T3CODE_TELEMETRY_OTLP_TOKEN: process.env.T3CODE_TELEMETRY_OTLP_TOKEN,
    T3CODE_MOBILE_EAS_PROJECT_ID: process.env.T3CODE_MOBILE_EAS_PROJECT_ID,
    T3CODE_MOBILE_EAS_OWNER: process.env.T3CODE_MOBILE_EAS_OWNER,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  for (const name of [
    "T3CODE_TELEMETRY_URL",
    "T3CODE_TELEMETRY_OTLP_TOKEN",
    "T3CODE_MOBILE_EAS_PROJECT_ID",
    "T3CODE_MOBILE_EAS_OWNER",
    "T3CODE_MOBILE_UPDATES_ENABLED",
    "T3CODE_RELAY_URL",
  ]) {
    vi.stubEnv(name, "");
  }
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it("routes mobile collection only to the configured collector and permits a fork EAS project", async () => {
  vi.stubEnv("T3CODE_TELEMETRY_URL", "https://collector.example.test");
  vi.stubEnv("T3CODE_TELEMETRY_OTLP_TOKEN", "write-token");
  vi.stubEnv("T3CODE_MOBILE_EAS_PROJECT_ID", "1a2b3c4d-1111-2222-3333-444455556666");
  vi.stubEnv("T3CODE_MOBILE_EAS_OWNER", "fork-owner");
  const config = await loadConfig("production");

  expect(config.updates?.url).toBe("https://u.expo.dev/1a2b3c4d-1111-2222-3333-444455556666");
  expect(config.updates?.enabled).toBe(true);
  expect(config.owner).toBe("fork-owner");
  expect(config.extra?.eas).toMatchObject({
    projectId: "1a2b3c4d-1111-2222-3333-444455556666",
    observe: {
      endpointUrl: "https://collector.example.test/v1/mobile/observe",
      collectEnabled: true,
    },
  });
  expect(config.extra?.telemetry).toEqual({
    url: "https://collector.example.test",
    otlpToken: "write-token",
  });
});

it("pins Expo Observe to an unroutable URL when telemetry is unset even when Relay is configured", async () => {
  vi.stubEnv("T3CODE_RELAY_URL", "https://relay.example.test");
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", "1");
  const config = await loadConfig("production");
  expect(config.extra?.eas).toMatchObject({
    observe: { endpointUrl: "https://observe.invalid", collectEnabled: false },
  });
  expect(config.updates?.enabled).toBe(false);
});
