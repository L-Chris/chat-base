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
