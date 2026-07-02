import { createParser } from "eventsource-parser";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatMessage,
  ChatMessagePart,
  Usage,
} from "./types.ts";
import type {
  ResponsesContentPart,
  ResponsesMessageContent,
  ResponsesMessageOutputItem,
  ResponsesOutputItem,
  ResponsesReasoningOutputItem,
  ResponsesRequest,
  ResponsesResponse,
} from "../adapters/responses.ts";
import { nowUnixSeconds, uuid } from "../tools/ids.ts";
import { SseEncoder } from "../stream/sse.ts";

export function responsesRequestToChatCompletionRequest(
  body: ResponsesRequest,
): ChatCompletionRequest {
  return {
    ...body,
    id: body.previous_response_id,
    messages: convertResponsesInput(body),
    stream: body.stream,
    response_format: body.response_format,
    tools: body.tools,
    tool_choice: body.tool_choice,
  };
}

export function convertResponsesInput(body: ResponsesRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (body.instructions) {
    messages.push({ role: "system", content: body.instructions });
  }

  if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
    return messages;
  }

  for (const item of body.input ?? []) {
    const role = item.role === "developer" ? "system" : item.role;
    const content = typeof item.content === "string"
      ? item.content
      : item.content.map(convertContentPart);
    messages.push({ role, content });
  }

  return messages;
}

function convertContentPart(part: ResponsesContentPart): ChatMessagePart {
  if (part.type === "input_text") {
    return { type: "text", text: part.text ?? "" };
  }

  if (part.type === "input_image") {
    const imageUrl = typeof part.image_url === "string"
      ? part.image_url
      : part.image_url?.url ?? "";
    return { type: "image_url", image_url: { url: imageUrl } };
  }

  const fileUrl = part.file?.file_id ?? part.file_id ?? "";
  return { type: "file", file_url: { url: fileUrl } };
}

export function buildResponsesResponse(
  completion: ChatCompletionChunk,
  options: {
    model?: string;
    request?: ResponsesRequest;
    id?: string;
    createdAt?: number;
  } = {},
): ResponsesResponse {
  const message = completion.choices[0]?.message;
  const output: ResponsesOutputItem[] = [];
  const reasoningContent = message?.reasoning_content;

  if (reasoningContent) {
    output.push({
      type: "reasoning",
      id: `rsn_${uuid(false)}`,
      summary: [{ type: "summary_text", text: reasoningContent }],
    });
  }

  output.push({
    type: "message",
    id: `msg_${uuid(false)}`,
    status: "completed",
    role: "assistant",
    content: [{
      type: "output_text",
      text: message?.content ?? "",
      annotations: completion.citations ?? [],
      logprobs: [],
    }],
  });

  return buildBaseResponsesResponse({
    id: options.id ?? `resp_${uuid(false)}`,
    status: completion.error ? "failed" : "completed",
    model: options.model ?? completion.model,
    output,
    usage: chatUsageToResponsesUsage(completion.usage),
    error: completion.error
      ? {
        message: completion.error.message,
        type: completion.error.type,
        code: completion.error.code,
      }
      : null,
    request: options.request,
    createdAt: options.createdAt,
  });
}

export class ResponsesStreamAdapter {
  private readonly encoder = new SseEncoder();
  private readonly decoder = new TextDecoder();
  private readonly callbacks: Array<() => void> = [];
  private readonly outputStream: ReadableStream<Uint8Array>;
  private readonly parser = createParser({
    onEvent: (event) => this.handleEvent({ data: event.data }),
  });

  private streamController!: ReadableStreamDefaultController<Uint8Array>;
  private phase: "idle" | "reasoning" | "content" | "done" = "idle";
  private readonly responseId = `resp_${uuid(false)}`;
  private readonly reasoningId = `rsn_${uuid(false)}`;
  private readonly messageId = `msg_${uuid(false)}`;
  private readonly createdAt = nowUnixSeconds();
  private reasoningText = "";
  private contentText = "";
  private citations: unknown[] = [];
  private usage: Usage | undefined;
  private sequenceNumber = 0;
  private lifecycleStarted = false;
  private closed = false;

  constructor(
    private readonly innerStream: ReadableStream<Uint8Array>,
    private readonly options: {
      model: string;
      request?: ResponsesRequest;
    },
  ) {
    this.outputStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.streamController = controller;
        void this.readInnerStream();
      },
    });
  }

  getStream(): ReadableStream<Uint8Array> {
    return this.outputStream;
  }

  onDone(callback: () => void): void {
    this.callbacks.push(callback);
  }

  private handleEvent(event: { data: string }): void {
    if (!event.data) return;
    if (event.data === "[DONE]") {
      this.processDone();
      return;
    }

    try {
      this.processChunk(JSON.parse(event.data) as ChatCompletionChunk);
    } catch {
      // Ignore malformed downstream chunks.
    }
  }

  private processChunk(chunk: ChatCompletionChunk): void {
    this.emitLifecycleEvents();

    if (chunk.error) {
      this.emitCompleted({
        message: chunk.error.message,
        type: chunk.error.type,
        code: chunk.error.code,
      });
      return;
    }

    if (Array.isArray(chunk.citations) && chunk.citations.length > 0) {
      this.citations = chunk.citations;
    }

    if (chunk.usage) this.usage = chunk.usage;

    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (delta?.reasoning_content) {
      this.writeReasoning(delta.reasoning_content);
    }

    if (delta?.content) {
      this.writeContent(delta.content);
    }

    if (choice?.finish_reason) {
      this.processDone();
    }
  }

  private processDone(): void {
    this.emitLifecycleEvents();
    if (this.phase === "reasoning") this.closeReasoning();
    if (this.phase === "content") this.closeMessage();
    this.emitCompleted(null);
  }

  private emitLifecycleEvents(): void {
    if (this.lifecycleStarted) return;
    this.lifecycleStarted = true;
    const response = this.buildResponseObject("in_progress", []);
    this.emit("response.created", {
      type: "response.created",
      response,
    });
    this.emit("response.in_progress", {
      type: "response.in_progress",
      response,
    });
  }

  private writeReasoning(text: string): void {
    if (this.phase === "content") {
      this.writeContent(text);
      return;
    }
    if (this.phase !== "reasoning") {
      this.openReasoning();
      this.phase = "reasoning";
    }
    this.reasoningText += text;
    this.emit("response.reasoning_summary_text.delta", {
      type: "response.reasoning_summary_text.delta",
      item_id: this.reasoningId,
      output_index: 0,
      content_index: 0,
      delta: text,
    });
  }

  private openReasoning(): void {
    this.emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "reasoning",
        id: this.reasoningId,
        summary: [],
      } satisfies ResponsesReasoningOutputItem,
    });
    this.emit("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: this.reasoningId,
      output_index: 0,
      content_index: 0,
      part: { type: "summary_text", text: "" },
    });
  }

  private closeReasoning(): void {
    this.emit("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      item_id: this.reasoningId,
      output_index: 0,
      content_index: 0,
      text: this.reasoningText,
    });
    this.emit("response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      item_id: this.reasoningId,
      output_index: 0,
      content_index: 0,
      part: { type: "summary_text", text: this.reasoningText },
    });
    this.emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "reasoning",
        id: this.reasoningId,
        summary: [{ type: "summary_text", text: this.reasoningText }],
      } satisfies ResponsesReasoningOutputItem,
    });
    this.phase = "idle";
  }

  private writeContent(text: string): void {
    if (this.phase === "reasoning") this.closeReasoning();
    if (this.phase !== "content") {
      this.openMessage();
      this.phase = "content";
    }
    this.contentText += text;
    this.emit("response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: this.messageId,
      output_index: this.messageOutputIndex(),
      content_index: 0,
      delta: text,
    });
  }

  private openMessage(): void {
    this.emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: this.messageOutputIndex(),
      item: {
        type: "message",
        id: this.messageId,
        status: "completed",
        role: "assistant",
        content: [],
      } satisfies ResponsesMessageOutputItem,
    });
    this.emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: this.messageId,
      output_index: this.messageOutputIndex(),
      content_index: 0,
      part: {
        type: "output_text",
        text: "",
        annotations: [],
        logprobs: [],
      },
    });
  }

  private closeMessage(): void {
    const part: ResponsesMessageContent = {
      type: "output_text",
      text: this.contentText,
      annotations: this.citations,
      logprobs: [],
    };
    this.emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: this.messageId,
      output_index: this.messageOutputIndex(),
      content_index: 0,
      text: this.contentText,
    });
    this.emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: this.messageId,
      output_index: this.messageOutputIndex(),
      content_index: 0,
      part,
    });
    this.emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: this.messageOutputIndex(),
      item: {
        type: "message",
        id: this.messageId,
        status: "completed",
        role: "assistant",
        content: [part],
      } satisfies ResponsesMessageOutputItem,
    });
    this.phase = "idle";
  }

  private emitCompleted(
    error: { message: string; type: string; code?: string } | null,
  ): void {
    if (this.phase === "done") return;
    this.phase = "done";
    const eventType = error ? "response.failed" : "response.completed";
    this.emit(eventType, {
      type: eventType,
      response: this.buildFinalResponse(error),
    });
    this.streamController.enqueue(this.encoder.encodeDone());
    this.closed = true;
    this.streamController.close();
    this.callbacks.forEach((callback) => callback());
  }

  private buildResponseObject(
    status: ResponsesResponse["status"],
    output: ResponsesOutputItem[],
  ): ResponsesResponse {
    return buildBaseResponsesResponse({
      id: this.responseId,
      status,
      model: this.options.model,
      output,
      usage: responsesUsage(0, 0, 0),
      error: null,
      request: this.options.request,
      createdAt: this.createdAt,
    });
  }

  private buildFinalResponse(
    error: { message: string; type: string; code?: string } | null,
  ): ResponsesResponse {
    const output: ResponsesOutputItem[] = [];
    if (this.reasoningText) {
      output.push({
        type: "reasoning",
        id: this.reasoningId,
        summary: [{ type: "summary_text", text: this.reasoningText }],
      });
    }
    output.push({
      type: "message",
      id: this.messageId,
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: this.contentText,
        annotations: this.citations,
        logprobs: [],
      }],
    });
    return buildBaseResponsesResponse({
      id: this.responseId,
      status: error ? "failed" : "completed",
      model: this.options.model,
      output,
      usage: chatUsageToResponsesUsage(this.usage),
      error,
      request: this.options.request,
      createdAt: this.createdAt,
    });
  }

  private emit(event: string, data: Record<string, unknown>): void {
    if (this.closed) return;
    this.sequenceNumber += 1;
    this.streamController.enqueue(
      this.encoder.encodeEvent(event, {
        ...data,
        sequence_number: this.sequenceNumber,
      }),
    );
  }

  private async readInnerStream(): Promise<void> {
    const reader = this.innerStream.getReader();
    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) {
          this.processDone();
          return;
        }
        this.parser.feed(this.decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      this.emitCompleted({
        message: error instanceof Error ? error.message : "unknown error",
        type: "server_error",
      });
    } finally {
      reader.releaseLock();
    }
  }

  private messageOutputIndex(): number {
    return this.reasoningText ? 1 : 0;
  }
}

function buildBaseResponsesResponse(params: {
  id: string;
  status: ResponsesResponse["status"];
  model: string;
  output: ResponsesOutputItem[];
  usage: ResponsesResponse["usage"];
  error: ResponsesResponse["error"];
  request?: ResponsesRequest;
  createdAt?: number;
}): ResponsesResponse {
  const createdAt = params.createdAt ?? nowUnixSeconds();
  return {
    id: params.id,
    object: "response",
    created_at: createdAt,
    completed_at: params.status === "completed" || params.status === "failed"
      ? nowUnixSeconds()
      : null,
    status: params.status,
    model: params.model,
    output: params.output,
    usage: params.usage,
    error: params.error,
    incomplete_details: null,
    instructions: params.request?.instructions ?? null,
    max_output_tokens: params.request?.max_output_tokens ?? null,
    max_tool_calls: null,
    previous_response_id: params.request?.previous_response_id ?? null,
    prompt_cache_key: null,
    reasoning: null,
    safety_identifier: null,
    service_tier: null,
    tools: params.request?.tools ?? null,
    text: { type: "text" },
    temperature: params.request?.temperature ?? null,
    top_p: null,
    tool_choice: params.request?.tool_choice ?? null,
    parallel_tool_calls: false,
    metadata: params.request?.metadata ?? {},
  };
}

function chatUsageToResponsesUsage(
  usage: Usage | undefined,
): ResponsesResponse["usage"] {
  return responsesUsage(
    usage?.prompt_tokens ?? 0,
    usage?.completion_tokens ?? 0,
    usage?.total_tokens ?? 0,
  );
}

function responsesUsage(
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
): ResponsesResponse["usage"] {
  return {
    input_tokens: inputTokens,
    input_tokens_details: null,
    output_tokens: outputTokens,
    output_tokens_details: null,
    total_tokens: totalTokens,
  };
}
