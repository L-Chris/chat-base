export function bearerToken(authHeader: string | null | undefined): string {
  return (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
}

export function parseKeyValueBearer(
  authHeader: string | null | undefined,
): Record<string, string> {
  const content = bearerToken(authHeader);
  const result: Record<string, string> = {};

  for (const part of content.split(/\s+/)) {
    const index = part.indexOf(":");
    if (index <= 0) continue;
    result[part.slice(0, index)] = part.slice(index + 1);
  }

  return result;
}

export function envFallbackToken(
  authHeader: string | null | undefined,
  envName: string,
  ignoredValues = new Set(["", "any-token", "test"]),
): string {
  const token = bearerToken(authHeader);
  if (!ignoredValues.has(token)) return token;
  return Deno.env.get(envName) ?? "";
}
