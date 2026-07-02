export function uuid(separator = true): string {
  const id = crypto.randomUUID();
  return separator ? id : id.replaceAll("-", "");
}

export function createId(prefix?: string, length = 24): string {
  const raw = uuid(false).slice(0, length);
  return prefix ? `${prefix}-${raw}` : raw;
}

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function randomString(params: {
  length: number;
  charset?: "hex" | "base64url" | string;
}): string {
  const alphabet = resolveAlphabet(params.charset);
  const bytes = new Uint8Array(params.length);
  crypto.getRandomValues(bytes);
  let output = "";
  for (let i = 0; i < params.length; i++) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

function resolveAlphabet(charset = "base64url"): string {
  if (charset === "hex") return "0123456789abcdef";
  if (charset === "base64url") {
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  }
  return charset;
}
