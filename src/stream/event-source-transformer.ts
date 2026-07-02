import { createParser } from "eventsource-parser";
import type { ChatMessage } from "../openai/types.ts";
import { OpenAIStreamWriter } from "./openai-stream.ts";

export interface EventSourceMessage {
  data: string;
  event?: string;
  id?: string;
}

export interface EventSourceTransformerHooks {
  onEvent?: (event: EventSourceMessage) => void;
  onRawChunk?: (chunkText: string, rawChunk: Uint8Array) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export interface EventSourceTransformerOptions {
  model: string;
  messages: ChatMessage[];
  hooks?: EventSourceTransformerHooks;
}

export abstract class EventSourceOpenAITransformer {
  private readonly decoder = new TextDecoder();
  private readonly hooks: EventSourceTransformerHooks;
  private readonly parser;
  private readonly stream: ReadableStream<Uint8Array>;
  private writer!: OpenAIStreamWriter;
  private finished = false;

  protected constructor(
    private readonly response: Response,
    private readonly options: EventSourceTransformerOptions,
  ) {
    this.hooks = options.hooks ?? {};
    this.parser = createParser({
      onEvent: (event) => {
        const normalized: EventSourceMessage = {
          data: event.data,
          event: event.event,
          id: event.id,
        };
        this.hooks.onEvent?.(normalized);
        this.handleEvent(normalized, this.writer);
      },
    });

    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.writer = new OpenAIStreamWriter(controller, {
          model: options.model,
          messages: options.messages,
        });
        void this.read();
      },
    });
  }

  getStream(): ReadableStream<Uint8Array> {
    return this.stream;
  }

  protected abstract handleEvent(
    event: EventSourceMessage,
    writer: OpenAIStreamWriter,
  ): void;

  protected finish(
    writer: OpenAIStreamWriter,
    options: Parameters<OpenAIStreamWriter["finish"]>[0] = {},
  ) {
    if (this.finished) return;
    this.finished = true;
    writer.finish(options);
    this.hooks.onDone?.();
  }

  private async read() {
    try {
      const contentType = this.response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const body = await this.response.text();
        const message = contentType.includes("text/html")
          ? "rejected by server"
          : body || this.response.statusText;
        this.hooks.onError?.(message);
        this.writer.error(message);
        this.finish(this.writer);
        return;
      }

      if (!this.response.body) {
        const message = "Response body is null";
        this.hooks.onError?.(message);
        this.writer.error(message);
        this.finish(this.writer);
        return;
      }

      const reader = this.response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            const tail = this.decoder.decode();
            if (tail) this.parser.feed(tail);
            this.finish(this.writer);
            return;
          }

          const decoded = this.decoder.decode(value, { stream: true });
          this.hooks.onRawChunk?.(decoded, value);
          this.parser.feed(decoded);
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.hooks.onError?.(message);
      this.writer.error(message);
      this.finish(this.writer);
    }
  }
}
