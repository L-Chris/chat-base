import type {
  BaseChatConfig,
  ChatRunInput,
  RequestContext,
} from "../core/mod.ts";
import {
  BaseChatProvider,
  bearerToken,
  missingAuthError,
  ModelFlagChatConfigStrategy,
} from "../core/mod.ts";
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

export interface OpenAICompatibleProviderOptions<TAuth = string>
  extends OpenAICompatibleClientOptions {
  providerName: string;
  defaultModel: string;
  separator?: "_" | "-";
  modelNameFilter?: (parts: string[]) => string;
  authenticate?: (headers: Headers) => Promise<TAuth> | TAuth;
  tokenFromAuth?: (auth: TAuth) => string | undefined;
  missingAuthMessage?: string;
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

export class OpenAICompatibleProvider<TAuth = string>
  extends BaseChatProvider<TAuth> {
  readonly name: string;
  private readonly client: OpenAICompatibleClient;
  private readonly configStrategy: ModelFlagChatConfigStrategy;

  constructor(
    private readonly providerOptions: OpenAICompatibleProviderOptions<TAuth>,
  ) {
    super();
    this.name = providerOptions.providerName;
    this.client = new OpenAICompatibleClient(providerOptions);
    this.configStrategy = new ModelFlagChatConfigStrategy({
      defaultModel: providerOptions.defaultModel,
      separator: providerOptions.separator,
      modelNameFilter: providerOptions.modelNameFilter,
    });
  }

  authenticate(headers: Headers): Promise<TAuth> | TAuth {
    if (this.providerOptions.authenticate) {
      return this.providerOptions.authenticate(headers);
    }

    const token = bearerToken(headers.get("authorization"));
    if (!token) {
      throw missingAuthError(
        this.providerOptions.missingAuthMessage ?? "need token",
      );
    }
    return token as TAuth;
  }

  buildConfig(body: ChatCompletionRequest): BaseChatConfig {
    return this.configStrategy.build({
      chatId: body.id as string | undefined,
      model: body.model,
      stream: body.stream,
      responseFormat: body.response_format,
      tools: body.tools,
      toolChoice: body.tool_choice,
      messages: body.messages,
    });
  }

  async createChatCompletion(
    input: ChatRunInput<TAuth>,
  ): Promise<ChatCompletionChunk> {
    return await this.client.createCompletion({
      apiKey: this.apiKey(input.context.auth),
      model: input.config.modelName,
      messages: input.messages,
      responseFormat: input.config.responseFormat,
      tools: input.config.tools,
      toolChoice: input.config.toolChoice,
    });
  }

  async createChatCompletionStream(
    input: ChatRunInput<TAuth>,
  ): Promise<ReadableStream<Uint8Array>> {
    return await this.client.createCompletionStream({
      apiKey: this.apiKey(input.context.auth),
      model: input.config.modelName,
      messages: input.messages,
      responseFormat: input.config.responseFormat,
      tools: input.config.tools,
      toolChoice: input.config.toolChoice,
    });
  }

  async listModels(
    context: RequestContext<TAuth>,
  ): Promise<ListModelsResponse> {
    return await this.client.listModels(this.apiKey(context.auth));
  }

  private apiKey(auth: TAuth): string {
    const token = this.providerOptions.tokenFromAuth
      ? this.providerOptions.tokenFromAuth(auth)
      : defaultTokenFromAuth(auth);
    if (!token) {
      throw missingAuthError(
        this.providerOptions.missingAuthMessage ?? "need token",
      );
    }
    return token;
  }
}

export function createOpenAICompatibleProvider<TAuth = string>(
  options: OpenAICompatibleProviderOptions<TAuth>,
): OpenAICompatibleProvider<TAuth> {
  return new OpenAICompatibleProvider(options);
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

function defaultTokenFromAuth<TAuth>(auth: TAuth): string | undefined {
  if (typeof auth === "string") return auth;
  if (auth && typeof auth === "object" && "token" in auth) {
    const token = (auth as { token?: unknown }).token;
    return typeof token === "string" ? token : undefined;
  }
  return undefined;
}
