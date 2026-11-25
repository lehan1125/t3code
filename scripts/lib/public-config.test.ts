// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_root\nT3CODE_CLERK_JWT_TEMPLATE=template_root\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root\nT3CODE_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_local\nT3CODE_CLERK_JWT_TEMPLATE=template_local\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_local\nT3CODE_RELAY_URL=https://local.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).T3CODE_RELAY_URL).toBe(
      "https://local.example.test",
    );
    expect(
      loadRepoEnv({
        baseEnv: {
          T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
          T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
          T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
          T3CODE_RELAY_URL: "https://ci.example.test",
        },
        repoRoot,
      }),
    ).toMatchObject({
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      T3CODE_RELAY_URL: "https://ci.example.test",
      VITE_T3CODE_RELAY_URL: "https://ci.example.test",
    });
  });

  it("exports only canonical telemetry settings to public build aliases", () => {
    const repoRoot = makeTemporaryDirectory();
    const env = loadRepoEnv({
      repoRoot,
      baseEnv: {
        T3CODE_TELEMETRY_URL: "http://127.0.0.1:4318",
        T3CODE_TELEMETRY_OTLP_TOKEN: "public-write-token",
        T3CODE_TELEMETRY_ANALYTICS_KEY: "private-analytics-key",
        VITE_RELAY_OTLP_TRACES_URL: "https://old.example.test",
        EXPO_PUBLIC_OTLP_TRACES_URL: "https://axiom.example.test",
      },
    });

    expect(env).toMatchObject({
      T3CODE_TELEMETRY_URL: "http://127.0.0.1:4318",
      VITE_T3CODE_TELEMETRY_URL: "http://127.0.0.1:4318",
      T3CODE_TELEMETRY_OTLP_TOKEN: "public-write-token",
      VITE_T3CODE_TELEMETRY_OTLP_TOKEN: "public-write-token",
      EXPO_PUBLIC_T3CODE_TELEMETRY_OTLP_TOKEN: "public-write-token",
    });
    expect(env.VITE_RELAY_OTLP_TRACES_URL).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_URL).toBeUndefined();
    expect(env.VITE_T3CODE_TELEMETRY_ANALYTICS_KEY).toBeUndefined();
  });

  it("rejects a non-loopback HTTP telemetry collector", () => {
    expect(() =>
      loadRepoEnv({ baseEnv: { T3CODE_TELEMETRY_URL: "http://collector.example.test" } }),
    ).toThrow("T3CODE_TELEMETRY_URL must be an HTTPS origin or HTTP loopback origin.");
  });

  it("does not pair a collector URL with credentials from a lower-precedence env file", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_TELEMETRY_URL=https://old.example.test\nT3CODE_TELEMETRY_OTLP_TOKEN=old-token\n",
    );

    const env = loadRepoEnv({
      repoRoot,
      baseEnv: { T3CODE_TELEMETRY_URL: "https://runtime.example.test" },
    });
    expect(env.T3CODE_TELEMETRY_URL).toBe("https://runtime.example.test");
    expect(env.T3CODE_TELEMETRY_OTLP_TOKEN).toBeUndefined();
    expect(env.VITE_T3CODE_TELEMETRY_OTLP_TOKEN).toBeUndefined();
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
