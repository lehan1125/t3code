export function telemetryOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function telemetryEndpoint(value: string | undefined, path: string): string | null {
  const origin = value?.trim() ? telemetryOrigin(value) : null;
  return origin ? new URL(path, origin).toString() : null;
}
