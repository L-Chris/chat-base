import type {
  ChatMessage,
  ResponseFormat,
  Tool,
  ToolChoice,
} from "../openai/types.ts";
import { normalizeResponseFormat } from "../openai/responses.ts";
import type { ToolCallDelimiterMarkers } from "../tools/tool-calling.ts";
import { createToolCallMarkers } from "../tools/tool-calling.ts";

export interface BaseChatFeatures {
  thinking?: boolean;
  searching?: boolean;
  deepsearching?: boolean;
  [key: string]: unknown;
}

export interface BaseChatConfig {
  chatId: string;
  model: string;
  modelName: string;
  stream: boolean;
  responseFormat: ResponseFormat;
  features: BaseChatFeatures;
  chatType: "t2t" | "t2v" | "t2i" | "search" | "artifacts";
  tools: Tool[];
  toolChoice: ToolChoice;
  isToolCalling: boolean;
  isToolCallingDone: boolean;
  toolDelimiter?: ToolCallDelimiterMarkers;
  extra: Record<string, unknown>;
}

export interface ChatConfigInput {
  chatId?: string;
  model?: string;
  stream?: boolean;
  responseFormat?: ResponseFormat;
  messages: ChatMessage[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  defaultModel?: string;
}

export interface ChatConfigStrategy {
  build(input: ChatConfigInput): BaseChatConfig;
}

export class ModelFlagChatConfigStrategy implements ChatConfigStrategy {
  constructor(
    private readonly options: {
      defaultModel: string;
      delimiterTools?: boolean;
      separator?: "_" | "-";
      modelNameFilter?: (parts: string[]) => string;
    },
  ) {}

  build(input: ChatConfigInput): BaseChatConfig {
    const model = input.model || input.defaultModel ||
      this.options.defaultModel;
    const separator = this.options.separator ?? "_";
    const parts = model.split(separator).filter(Boolean);
    const tools = input.tools ?? [];
    const responseFormat = normalizeResponseFormat(input.responseFormat);
    const isToolCalling = tools.length > 0 &&
      !input.messages.some((message) => message.role === "tool");
    const isToolCallingDone = tools.length > 0 &&
      input.messages.some((message) => message.role === "tool");
    const returnArtifacts = responseFormat.type === "json_schema" ||
      isToolCalling;

    return {
      chatId: input.chatId ?? "",
      model,
      modelName: this.options.modelNameFilter?.(parts) ?? parts[0] ??
        this.options.defaultModel,
      stream: typeof input.stream === "boolean" ? input.stream : false,
      responseFormat,
      features: {
        thinking: parts.includes("think"),
        searching: parts.includes("search") || parts.includes("deepsearch"),
        deepsearching: parts.includes("deepsearch"),
      },
      chatType: parts.includes("search") || parts.includes("deepsearch")
        ? "search"
        : returnArtifacts
        ? "artifacts"
        : "t2t",
      tools,
      toolChoice: input.toolChoice ?? "auto",
      isToolCalling,
      isToolCallingDone,
      toolDelimiter: this.options.delimiterTools && tools.length
        ? createToolCallMarkers()
        : undefined,
      extra: {},
    };
  }
}
