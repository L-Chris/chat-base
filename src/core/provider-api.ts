import type {
  ChatCompletionChunk,
  ChatMessage,
  ResponseFormat,
  Tool,
  Usage,
} from "../openai/types.ts";
import {
  createChatCompletion,
  normalizeChatCompletionResponse,
} from "../openai/responses.ts";
import {
  type CollectedOpenAIStream,
  collectOpenAIStream,
} from "../stream/openai-stream.ts";

export interface StreamTransformer {
  getStream(): ReadableStream<Uint8Array>;
  onDone?(callback: () => void): void;
}

export interface ProviderRequest {
  url: string | URL;
  init?: RequestInit;
}

export interface ProviderApiClientOptions {
  name?: string;
  fetch?: typeof fetch;
}

export interface CompletionStreamOptions {
  request: ProviderRequest | Promise<ProviderRequest>;
  createTransformer: (response: Response) => StreamTransformer;
  onDone?: () => void;
}

export interface CompletionFromStreamOptions extends CompletionStreamOptions {
  model: string;
  messages?: ChatMessage[];
  responseFormat?: ResponseFormat;
  tools?: Tool[];
  defaultUsage?: Usage;
  normalize?: boolean;
}

export class ProviderApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ProviderApiClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async json<T = unknown>(
    request: ProviderRequest | Promise<ProviderRequest>,
  ): Promise<T> {
    const response = await this.request(request);
    if (!response.ok) {
      throw new Error(await this.formatError(response));
    }
    return await response.json() as T;
  }

  async request(
    request: ProviderRequest | Promise<ProviderRequest>,
  ): Promise<Response> {
    const resolved = await request;
    return await this.fetchImpl(resolved.url, resolved.init);
  }

  async eventStream(
    request: ProviderRequest | Promise<ProviderRequest>,
  ): Promise<Response> {
    const response = await this.request(request);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      throw new Error(await this.formatError(response));
    }
    return response;
  }

  async createCompletionStream(
    options: CompletionStreamOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.request(options.request);
    const transformer = options.createTransformer(response);
    if (options.onDone) transformer.onDone?.(options.onDone);
    return transformer.getStream();
  }

  async createCompletion(
    options: CompletionFromStreamOptions,
  ): Promise<ChatCompletionChunk> {
    const stream = await this.createCompletionStream(options);
    const collected = await collectOpenAIStream(stream, {
      model: options.model,
    });
    const response = createChatCompletionFromCollected(
      collected,
      options.model,
      options.defaultUsage,
    );
    return options.normalize === false
      ? response
      : normalizeChatCompletionResponse(response, {
        responseFormat: options.responseFormat,
        tools: options.tools,
      });
  }

  private async formatError(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const message = contentType.includes("text/html")
      ? "rejected by server"
      : body || response.statusText;
    const prefix = this.options.name
      ? `${this.options.name} API error`
      : "API error";
    return `${prefix}: ${response.status} ${message}`;
  }
}

export function createChatCompletionFromCollected(
  collected: CollectedOpenAIStream,
  model: string = collected.model,
  defaultUsage: Usage = {
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
  },
): ChatCompletionChunk {
  return createChatCompletion({
    id: collected.id,
    model,
    content: collected.content,
    reasoningContent: collected.reasoningContent,
    toolCalls: collected.toolCalls,
    finishReason: collected.finishReason,
    citations: collected.citations,
    created: collected.created,
    usage: collected.usage ?? defaultUsage,
  });
}
