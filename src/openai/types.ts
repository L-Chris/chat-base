export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessagePart {
  type: "text" | "file" | "image" | "image_url";
  text?: string;
  file_url?: { url: string };
  image_url?: { url: string };
  [key: string]: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatMessagePart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
  [key: string]: unknown;
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
  index?: number;
}

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema?: Record<string, unknown> | {
    name?: string;
    schema?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface JsonObjectResponseFormat {
  type: "json_object";
}

export interface TextResponseFormat {
  type: "text";
}

export type ResponseFormat =
  | TextResponseFormat
  | JsonSchemaResponseFormat
  | JsonObjectResponseFormat;

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  response_format?: ResponseFormat;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  [key: string]: unknown;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  [key: string]: unknown;
}

export type FinishReason =
  | null
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter";

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk" | "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta?: {
      role?: "assistant";
      content?: string;
      reasoning_content?: string;
      tool_calls?: ToolCall[];
    };
    message?: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: FinishReason;
  }>;
  usage?: Usage;
  citations?: unknown[];
  error?: {
    message: string;
    type: string;
    code?: string;
  };
}

export interface Model {
  id: string;
  object?: "model";
  created?: number;
  owned_by?: string;
  [key: string]: unknown;
}

export interface ListModelsResponse {
  object?: "list";
  data: Model[];
}
