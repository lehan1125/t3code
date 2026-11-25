// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap reads optional root env files before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { telemetryOrigin } from "@t3tools/shared/telemetryEndpoint";

export interface T3CodePublicConfig {
  readonly clerkPublishableKey: string | undefined;
  readonly clerkJwtTemplate: string | undefined;
  readonly clerkCliOAuthClientId: string | undefined;
  readonly relayUrl: string | undefined;
  readonly telemetryUrl: string | undefined;
  readonly telemetryOtlpToken: string | undefined;
}

type Environment = Readonly<Record<string, string | undefined>>;

const REPO_ROOT = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../../..");
const LEGACY_TELEMETRY_ENV_NAMES = [
  "T3CODE_MOBILE_OTLP_TRACES_URL",
  "T3CODE_MOBILE_OTLP_TRACES_DATASET",
  "T3CODE_MOBILE_OTLP_TRACES_TOKEN",
  "EXPO_PUBLIC_OTLP_TRACES_URL",
  "EXPO_PUBLIC_OTLP_TRACES_DATASET",
  "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
  "VITE_RELAY_OTLP_TRACES_URL",
  "VITE_RELAY_OTLP_TRACES_DATASET",
  "VITE_RELAY_OTLP_TRACES_TOKEN",
] as const;

export function loadRepoEnv({
  baseEnv = process.env,
  repoRoot = REPO_ROOT,
}: {
  readonly baseEnv?: Environment;
  readonly repoRoot?: string;
} = {}): Record<string, string | undefined> {
  const rootEnv = readEnvFile(NodePath.join(repoRoot, ".env"));
  const localEnv = readEnvFile(NodePath.join(repoRoot, ".env.local"));
  const config = resolvePublicConfig(baseEnv, localEnv, rootEnv);

  const result: Record<string, string | undefined> = {
    ...rootEnv,
    ...localEnv,
    ...baseEnv,
    ...(config.clerkPublishableKey
      ? {
          T3CODE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          VITE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
        }
      : {}),
    ...(config.clerkJwtTemplate
      ? {
          T3CODE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          VITE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          EXPO_PUBLIC_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
        }
      : {}),
    ...(config.clerkCliOAuthClientId
      ? {
          T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
          VITE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
        }
      : {}),
    ...(config.relayUrl
      ? {
          T3CODE_RELAY_URL: config.relayUrl,
          VITE_T3CODE_RELAY_URL: config.relayUrl,
        }
      : {}),
  };
  for (const name of LEGACY_TELEMETRY_ENV_NAMES) delete result[name];
  delete result.T3CODE_TELEMETRY_URL;
  delete result.T3CODE_TELEMETRY_OTLP_TOKEN;
  if (config.telemetryUrl) {
    result.T3CODE_TELEMETRY_URL = config.telemetryUrl;
    result.VITE_T3CODE_TELEMETRY_URL = config.telemetryUrl;
  }
  if (config.telemetryOtlpToken) {
    result.T3CODE_TELEMETRY_OTLP_TOKEN = config.telemetryOtlpToken;
    result.VITE_T3CODE_TELEMETRY_OTLP_TOKEN = config.telemetryOtlpToken;
    result.EXPO_PUBLIC_T3CODE_TELEMETRY_OTLP_TOKEN = config.telemetryOtlpToken;
  }
  return result;
}

function resolvePublicConfig(...sources: readonly Environment[]): T3CodePublicConfig {
  const telemetrySource = sources.find((source) => source.T3CODE_TELEMETRY_URL?.trim());
  const telemetryUrl = telemetrySource?.T3CODE_TELEMETRY_URL?.trim();
  const telemetryOriginValue = telemetryUrl ? telemetryOrigin(telemetryUrl) : null;
  if (telemetryUrl && !telemetryOriginValue) {
    throw new Error("T3CODE_TELEMETRY_URL must be an HTTPS origin or HTTP loopback origin.");
  }
  return {
    clerkPublishableKey: firstNonEmpty(
      sources,
      "T3CODE_CLERK_PUBLISHABLE_KEY",
      "VITE_CLERK_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    ),
    clerkJwtTemplate: firstNonEmpty(
      sources,
      "T3CODE_CLERK_JWT_TEMPLATE",
      "VITE_CLERK_JWT_TEMPLATE",
      "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
    ),
    clerkCliOAuthClientId: firstNonEmpty(
      sources,
      "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
      "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
    ),
    relayUrl: firstNonEmpty(sources, "T3CODE_RELAY_URL", "VITE_T3CODE_RELAY_URL"),
    telemetryUrl: telemetryOriginValue ?? undefined,
    telemetryOtlpToken: telemetrySource?.T3CODE_TELEMETRY_OTLP_TOKEN?.trim() || undefined,
  };
}

function firstNonEmpty(sources: readonly Environment[], ...names: readonly string[]) {
  for (const source of sources) {
    for (const name of names) {
      const value = source[name]?.trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function readEnvFile(path: string): Record<string, string | undefined> {
  return NodeFS.existsSync(path) ? NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8")) : {};
}
