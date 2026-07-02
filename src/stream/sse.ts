export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
} as const;

export class SseEncoder {
  private readonly encoder = new TextEncoder();

  encodeData(data: unknown): Uint8Array {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    return this.encoder.encode(`data: ${payload}\n\n`);
  }

  encodeEvent(event: string, data: unknown): Uint8Array {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    return this.encoder.encode(`event: ${event}\ndata: ${payload}\n\n`);
  }

  encodeDone(): Uint8Array {
    return this.encodeData("[DONE]");
  }
}

export function sseResponse(
  stream: ReadableStream<Uint8Array>,
  headers: HeadersInit = {},
): Response {
  return new Response(stream, {
    headers: {
      ...SSE_HEADERS,
      ...headers,
    },
  });
}
