import type { BaseChatFeatures } from "../core/chat-config.ts";
import type { ToolCallDelimiterMarkers as OpenAIToolCallDelimiterMarkers } from "../tools/tool-calling.ts";
import type {
  ChatCompletionChunk,
  ChatMessage,
  ChatMessagePart,
  ResponseFormat as OpenAIResponseFormat,
  Tool as OpenAITool,
  ToolCall as OpenAIToolCall,
  ToolChoice as OpenAIToolChoice,
} from "./types.ts";

export namespace OpenAI {
  export type Message = ChatMessage;
  export type MessageContent = ChatMessagePart;
  export type CompletionChunk = ChatCompletionChunk;
  export type Completion = ChatCompletionChunk;
  export type Tool = OpenAITool;
  export type ToolCall = OpenAIToolCall;
  export type ToolChoice = OpenAIToolChoice;
  export type ResponseFormat = OpenAIResponseFormat;
  export type ToolCallDelimiterMarkers = OpenAIToolCallDelimiterMarkers;

  export interface ChatConfig {
    chat_id: string;
    chat_type: "t2t" | "t2v" | "t2i" | "search" | "artifacts";
    model_name: string;
    model_type?: string;
    model?: string;
    access_token?: string;
    mode?: string;
    version?: string;
    response_format: OpenAIResponseFormat;
    features: BaseChatFeatures;
    stream: boolean;
    tools: OpenAITool[];
    tool_choice: OpenAIToolChoice;
    parallel_tool_calls: boolean;
    is_tool_calling?: boolean;
    is_tool_calling_done?: boolean;
    toolDelimiter?: OpenAIToolCallDelimiterMarkers;
  }
}
