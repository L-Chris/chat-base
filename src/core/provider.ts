import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatMessage,
  ListModelsResponse,
} from "../openai/types.ts";
import type { BaseChatConfig } from "./chat-config.ts";

export interface RequestContext<TAuth = unknown> {
  auth: TAuth;
  headers: Headers;
  rawRequest: Request;
}

export interface ChatRunInput<TAuth = unknown> {
  body: ChatCompletionRequest;
  messages: ChatMessage[];
  config: BaseChatConfig;
  context: RequestContext<TAuth>;
}

export interface ChatProvider<TAuth = unknown> {
  readonly name: string;
  authenticate(headers: Headers): Promise<TAuth> | TAuth;
  buildConfig(input: ChatCompletionRequest): BaseChatConfig;
  createChatCompletion(
    input: ChatRunInput<TAuth>,
  ): Promise<ChatCompletionChunk> | ChatCompletionChunk;
  createChatCompletionStream(
    input: ChatRunInput<TAuth>,
  ): Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array>;
  listModels(
    context: RequestContext<TAuth>,
  ): Promise<ListModelsResponse> | ListModelsResponse;
}

export abstract class BaseChatProvider<TAuth = string>
  implements ChatProvider<TAuth> {
  abstract readonly name: string;

  abstract authenticate(headers: Headers): Promise<TAuth> | TAuth;

  abstract buildConfig(input: ChatCompletionRequest): BaseChatConfig;

  abstract createChatCompletion(
    input: ChatRunInput<TAuth>,
  ): Promise<ChatCompletionChunk> | ChatCompletionChunk;

  abstract createChatCompletionStream(
    input: ChatRunInput<TAuth>,
  ): Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array>;

  abstract listModels(
    context: RequestContext<TAuth>,
  ): Promise<ListModelsResponse> | ListModelsResponse;
}
