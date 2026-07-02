const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/png",
  "image/bmp",
  "image/gif",
  "image/svg+xml",
  "image/webp",
  "image/ico",
  "image/heic",
  "image/heif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/x-png",
]);

export function isDataUrl(value: string): boolean {
  return /^data:/i.test(value);
}

export function extractDataUrlMime(value: string): string | null {
  const match = value.trim().match(/^data:(.+?);base64,/i);
  return match?.[1] ?? null;
}

export function removeDataUrlHeader(value: string): string {
  return value.replace(/^data:(.+?);base64,/i, "");
}

export function base64ToUint8Array(value: string): Uint8Array {
  return Uint8Array.from(
    atob(removeDataUrlHeader(value)),
    (char) => char.charCodeAt(0),
  );
}

export function isImageMime(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

export async function fetchFileBytes(url: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch file: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const filename = inferFilename(url, contentType);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, contentType, filename };
}

export function inferFilename(url: string, contentType = ""): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    if (name) return decodeURIComponent(name);
  } catch {
    // fall through
  }
  const ext = contentType.split("/")[1]?.split(";")[0] || "bin";
  return `file.${ext}`;
}
