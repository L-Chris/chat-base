import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatMessage,
  ListModelsResponse,
  ResponseFormat,
  Tool,
  ToolChoice,
} from "../openai/types.ts";
import { normalizeChatCompletionResponse } from "../openai/responses.ts";
import {
  ProviderApiClient,
  type ProviderRequest,
} from "../core/provider-api.ts";
import { appendJsonSchemaPrompt } from "../openai/responses.ts";
import { messageContentToText } from "../tools/messages.ts";

export interface OpenAICompatibleClientOptions {
  baseUrl: string;
  name?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit | ((apiKey?: string) => HeadersInit);
  jsonSchemaMode?: "json_object" | "prompt" | "native";
}

export interface OpenAICompatibleRequestOptions {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  responseFormat?: ResponseFormat;
  tools?: Tool[];
  toolChoice?: ToolChoice;
  extra?: Record<string, unknown>;
  apiKey?: string;
}

export class OpenAICompatibleClient {
  private readonly api: ProviderApiClient;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAICompatibleClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.api = new ProviderApiClient({
      name: options.name ?? "openai-compatible",
      fetch: options.fetch,
    });
  }

  createChatRequest(options: OpenAICompatibleRequestOptions): ProviderRequest {
    const body = buildOpenAICompatibleChatBody({
      ...options,
      jsonSchemaMode: this.options.jsonSchemaMode,
    });

    return {
      url: `${this.baseUrl}/v1/chat/completions`,
      init: {
        method: "POST",
        headers: this.buildHeaders(options.apiKey),
        body: JSON.stringify(body),
      },
    };
  }

  async createCompletion(
    options: OpenAICompatibleRequestOptions,
  ): Promise<ChatCompletionChunk> {
    const result = await this.api.json<ChatCompletionChunk>(
      this.createChatRequest({ ...options, stream: false }),
    );
    return normalizeChatCompletionResponse(result, {
      responseFormat: options.responseFormat,
      tools: options.tools,
    });
  }

  async createCompletionStream(
    options: OpenAICompatibleRequestOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.api.request(
      this.createChatRequest({ ...options, stream: true }),
    );
    if (!response.body) {
      throw new Error("Response body is null");
    }
    return response.body;
  }

  async listModels(apiKey?: string): Promise<ListModelsResponse> {
    return await this.api.json<ListModelsResponse>({
      url: `${this.baseUrl}/v1/models`,
      init: {
        method: "GET",
        headers: this.buildHeaders(apiKey),
      },
    });
  }

  private buildHeaders(apiKey?: string): HeadersInit {
    if (typeof this.options.headers === "function") {
      return this.options.headers(apiKey ?? this.options.apiKey);
    }
    return {
      Authorization: `Bearer ${apiKey ?? this.options.apiKey ?? ""}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream,application/json",
      ...this.options.headers,
    };
  }
}

export function buildOpenAICompatibleChatBody(
  options: OpenAICompatibleRequestOptions & {
    jsonSchemaMode?: OpenAICompatibleClientOptions["jsonSchemaMode"];
  },
): ChatCompletionRequest {
  const jsonSchemaMode = options.jsonSchemaMode ?? "json_object";
  const messages = normalizeTextMessages(
    jsonSchemaMode === "prompt"
      ? appendJsonSchemaPrompt(
        options.messages,
        options.responseFormat,
      )
      : options.messages,
  );
  const responseFormat = resolveResponseFormat(
    options.responseFormat,
    jsonSchemaMode,
  );
  const tools = options.tools ?? [];

  return {
    model: options.model,
    messages,
    stream: !!options.stream,
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(tools.length ? { tools } : {}),
    ...(tools.length && options.toolChoice
      ? { tool_choice: options.toolChoice }
      : {}),
    ...options.extra,
  };
}

export function normalizeTextMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? messageContentToText(message.content)
      : message.content,
  }));
}

function resolveResponseFormat(
  responseFormat: ResponseFormat | undefined,
  mode: OpenAICompatibleClientOptions["jsonSchemaMode"],
): ResponseFormat | undefined {
  if (!responseFormat || responseFormat.type === "text") return undefined;
  if (responseFormat.type === "json_schema" && mode === "json_object") {
    return { type: "json_object" };
  }
  if (responseFormat.type === "json_schema" && mode === "prompt") {
    return undefined;
  }
  return responseFormat;
}
