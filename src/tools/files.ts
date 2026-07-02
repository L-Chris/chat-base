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

const MIME_EXTENSIONS: Record<string, string> = {
  "text/plain": "txt",
  "application/json": "json",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export interface FileInput {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  type: "image" | "file";
  source: string;
}

export interface FileMessagePartLike {
  type: string;
  text?: string;
  file_url?: { url?: string };
  image_url?: { url?: string };
  [key: string]: unknown;
}

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

export function bytesToBase64(bytes: Uint8Array, chunkSize = 0x8000): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function isImageMime(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

export function mimeToExtension(mimeType: string): string | null {
  return MIME_EXTENSIONS[mimeType.toLowerCase().split(";")[0].trim()] ?? null;
}

export function inferFileType(mimeType: string): "image" | "file" {
  return isImageMime(mimeType) ? "image" : "file";
}

export function dataUrlToFileInput(
  value: string,
  options: { filenamePrefix?: string; fallbackMime?: string } = {},
): FileInput {
  const contentType = extractDataUrlMime(value) ??
    options.fallbackMime ?? "application/octet-stream";
  const ext = mimeToExtension(contentType) ??
    contentType.split("/")[1]?.split(";")[0] ?? "bin";
  const type = inferFileType(contentType);
  const filename = `${options.filenamePrefix ?? type}_${Date.now()}.${ext}`;
  return {
    bytes: base64ToUint8Array(value),
    filename,
    contentType,
    type,
    source: value,
  };
}

export function extractFileUrlsFromContentParts(
  parts: FileMessagePartLike[],
): string[] {
  const urls: string[] = [];
  for (const part of parts) {
    const url = part.type === "file"
      ? part.file_url?.url
      : part.type === "image_url"
      ? part.image_url?.url
      : undefined;
    if (url) urls.push(url);
  }
  return urls;
}

export async function resolveFileInput(
  source: string,
  options: { filename?: string; fallbackMime?: string } = {},
): Promise<FileInput> {
  if (isDataUrl(source)) {
    const input = dataUrlToFileInput(source, {
      filenamePrefix: options.filename?.replace(/\.[^.]+$/, ""),
      fallbackMime: options.fallbackMime,
    });
    return options.filename ? { ...input, filename: options.filename } : input;
  }

  const fetched = await fetchFileBytes(source);
  const contentType = fetched.contentType || options.fallbackMime ||
    "application/octet-stream";
  return {
    bytes: fetched.bytes,
    contentType,
    filename: options.filename ?? fetched.filename,
    type: inferFileType(contentType),
    source,
  };
}

export function extractDataUrlFileInputsFromMessage(
  message: { content?: string | FileMessagePartLike[] },
): FileInput[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((part) => {
    const url = part.type === "file"
      ? part.file_url?.url
      : part.type === "image_url"
      ? part.image_url?.url
      : undefined;
    if (!url || !isDataUrl(url)) return [];
    return [dataUrlToFileInput(url, {
      filenamePrefix: part.type === "image_url" ? "image" : "file",
    })];
  });
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
