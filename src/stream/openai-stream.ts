import { approximateTokenSize } from "tokenx";
import type {
  ChatCompletionChunk,
  ChatMessage,
  ToolCall,
  Usage,
} from "../openai/types.ts";
import {
  createChatChunk,
  createDoneChunk,
  createErrorChunk,
} from "../openai/responses.ts";
import { messagesToText } from "../tools/messages.ts";
import { createId, nowUnixSeconds } from "../tools/ids.ts";
import { SseEncoder } from "./sse.ts";

export interface OpenAIStreamOptions {
  model: string;
  messages?: ChatMessage[];
  id?: string;
  created?: number;
}

export class OpenAIStreamWriter {
  private readonly encoder = new SseEncoder();
  private readonly id: string;
  private readonly created: number;
  private readonly messages: ChatMessage[];
  private content = "";
  private reasoningContent = "";
  private closed = false;

  constructor(
    private readonly controller: ReadableStreamDefaultController<Uint8Array>,
    private readonly options: OpenAIStreamOptions,
  ) {
    this.id = options.id ?? createId("chatcmpl");
    this.created = options.created ?? nowUnixSeconds();
    this.messages = options.messages ?? [];
  }

  write(params: {
    content?: string;
    reasoningContent?: string;
    citations?: unknown[];
  }) {
    if (this.closed) return;
    this.content += params.content ?? "";
    this.reasoningContent += params.reasoningContent ?? "";
    this.enqueue(createChatChunk({
      id: this.id,
      created: this.created,
      model: this.options.model,
      content: params.content,
      reasoningContent: params.reasoningContent,
      citations: params.citations,
    }));
  }

  error(message: string, options: { type?: string; code?: string } = {}) {
    if (this.closed) return;
    this.enqueue(createErrorChunk({
      id: this.id,
      created: this.created,
      model: this.options.model,
      message,
      type: options.type,
      code: options.code,
    }));
  }

  finish(options: {
    finishReason?: "stop" | "tool_calls" | "length" | "content_filter";
    content?: string;
    reasoningContent?: string;
    toolCalls?: ToolCall[];
    usage?: Usage;
  } = {}) {
    if (this.closed) return;

    const chunk = createDoneChunk({
      id: this.id,
      created: this.created,
      model: this.options.model,
      content: options.content ?? "",
      reasoningContent: options.reasoningContent ?? "",
      finishReason: options.finishReason ?? "stop",
      usage: options.usage ?? this.estimateUsage(),
    });

    if (options.toolCalls?.length) {
      chunk.choices[0].delta = {
        role: "assistant",
        content: options.content ?? "",
        tool_calls: options.toolCalls,
      };
      chunk.choices[0].finish_reason = "tool_calls";
    }

    this.enqueue(chunk);
    this.controller.enqueue(this.encoder.encodeDone());
    this.controller.close();
    this.closed = true;
  }

  snapshot(): { content: string; reasoningContent: string } {
    return {
      content: this.content,
      reasoningContent: this.reasoningContent,
    };
  }

  estimateUsage(): Usage {
    const promptTokens = approximateTokenSize(messagesToText(this.messages));
    const completionTokens = approximateTokenSize(
      this.content + this.reasoningContent,
    );
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    };
  }

  private enqueue(chunk: ChatCompletionChunk) {
    this.controller.enqueue(this.encoder.encodeData(chunk));
  }
}

export interface CollectedOpenAIStream {
  id: string;
  model: string;
  content: string;
  reasoningContent: string;
  citations: unknown[];
  usage?: Usage;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "content_filter";
  created: number;
}

export async function collectOpenAIStream(
  stream: ReadableStream<Uint8Array>,
  options: { model: string; id?: string; created?: number },
): Promise<CollectedOpenAIStream> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let citations: unknown[] = [];
  let usage: Usage | undefined;
  let lastError: string | null = null;
  let id = options.id ?? "";
  let created = options.created ?? nowUnixSeconds();
  let finishReason: CollectedOpenAIStream["finishReason"] = "stop";
  const toolCalls: ToolCall[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        if (tail) buffer += tail;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const line = event.split("\n").find((item) =>
          item.startsWith("data: ")
        );
        if (!line) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data) as ChatCompletionChunk;
          if (chunk.error) {
            lastError = chunk.error.message;
            continue;
          }

          if (chunk.id) id = chunk.id;
          if (chunk.created) created = chunk.created;
          if (chunk.citations?.length) citations = chunk.citations;
          if (chunk.usage) usage = chunk.usage;

          const choice = chunk.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) {
            finishReason = choice.finish_reason as CollectedOpenAIStream[
              "finishReason"
            ];
          }

          const delta = choice.delta;
          if (delta?.content) content += delta.content;
          if (delta?.reasoning_content) {
            reasoningContent += delta.reasoning_content;
          }
          if (delta?.tool_calls?.length) {
            toolCalls.push(...delta.tool_calls);
          }
        } catch {
          // Ignore malformed downstream chunks.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (lastError) throw new Error(lastError);

  return {
    id,
    model: options.model,
    content,
    reasoningContent,
    citations,
    usage,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : finishReason,
    created,
  };
}
