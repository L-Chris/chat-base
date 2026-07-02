import type {
  ChatCompletionChunk,
  ChatMessage,
  ResponseFormat,
  Tool,
  ToolChoice,
} from "../openai/types.ts";
import { createId, nowUnixSeconds } from "../tools/ids.ts";

export interface ResponsesRequest {
  model: string;
  input: string | ResponsesInputItem[];
  instructions?: string;
  stream?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  response_format?: ResponseFormat;
  previous_response_id?: string;
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

export interface ResponsesInputItem {
  role: "user" | "assistant" | "system" | "developer";
  content: string | ResponsesContentPart[];
}

export interface ResponsesContentPart {
  type: "input_text" | "input_file" | "input_image" | "output_text";
  text?: string;
  file?: { file_id?: string };
  file_id?: string;
  image_url?: string | { url?: string };
}

export type ResponsesOutputItem =
  | ResponsesReasoningOutputItem
  | ResponsesMessageOutputItem;

export interface ResponsesReasoningOutputItem {
  type: "reasoning";
  id: string;
  summary: ResponsesReasoningSummary[];
}

export interface ResponsesReasoningSummary {
  type: "summary_text";
  text: string;
}

export interface ResponsesMessageOutputItem {
  type: "message";
  id: string;
  status: "completed";
  role: "assistant";
  content: ResponsesMessageContent[];
}

export interface ResponsesMessageContent {
  type: "output_text";
  text: string;
  annotations: unknown[];
  logprobs: unknown[];
}

export interface ResponsesResponse {
  id: string;
  object: "response";
  created_at: number;
  completed_at: number | null;
  status: "completed" | "failed" | "in_progress";
  model: string;
  output: ResponsesOutputItem[];
  usage: ResponsesUsage;
  error: null | { message: string; type: string; code?: string };
  incomplete_details: null;
  instructions: string | null;
  max_output_tokens: number | null;
  max_tool_calls: null;
  previous_response_id: string | null;
  prompt_cache_key: null;
  reasoning: null;
  safety_identifier: null;
  service_tier: string | null;
  tools: Tool[] | null;
  text: null | { type: "text" };
  temperature: number | null;
  top_p: null;
  tool_choice: ToolChoice | null;
  parallel_tool_calls: boolean;
  metadata: Record<string, string>;
}

export interface ResponsesUsage {
  input_tokens: number;
  input_tokens_details: null;
  output_tokens: number;
  output_tokens_details: null;
  total_tokens: number;
}

export function responsesInputToMessages(
  request: ResponsesRequest,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (request.instructions) {
    messages.push({ role: "system", content: request.instructions });
  }

  if (typeof request.input === "string") {
    messages.push({ role: "user", content: request.input });
    return messages;
  }

  for (const item of request.input) {
    messages.push({
      role: item.role === "developer" ? "system" : item.role,
      content: responsesContentToText(item.content),
    });
  }

  return messages;
}

export function chatCompletionToResponses(
  completion: ChatCompletionChunk,
  options: { instructions?: string | null } = {},
): ResponsesResponse {
  const choice = completion.choices[0];
  const message = choice.message;
  const content = message?.content ?? "";
  const reasoning = message?.reasoning_content ?? "";
  const now = nowUnixSeconds();

  const output: ResponsesOutputItem[] = [];
  if (reasoning) {
    output.push({
      type: "reasoning",
      id: createId("rs"),
      summary: [{ type: "summary_text", text: reasoning }],
    });
  }
  output.push({
    type: "message",
    id: createId("msg"),
    status: "completed",
    role: "assistant",
    content: [{
      type: "output_text",
      text: content,
      annotations: [],
      logprobs: [],
    }],
  });

  return {
    id: createId("resp"),
    object: "response",
    created_at: completion.created ?? now,
    completed_at: now,
    status: "completed",
    model: completion.model,
    output,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      input_tokens_details: null,
      output_tokens: completion.usage?.completion_tokens ?? 0,
      output_tokens_details: null,
      total_tokens: completion.usage?.total_tokens ?? 0,
    },
    error: null,
    incomplete_details: null,
    instructions: options.instructions ?? null,
    max_output_tokens: null,
    max_tool_calls: null,
    previous_response_id: null,
    prompt_cache_key: null,
    reasoning: null,
    safety_identifier: null,
    service_tier: null,
    tools: null,
    text: null,
    temperature: null,
    top_p: null,
    tool_choice: null,
    parallel_tool_calls: true,
    metadata: {},
  };
}

function responsesContentToText(
  content: string | ResponsesContentPart[],
): string {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "input_text" || part.type === "output_text") {
      return part.text ?? "";
    }
    if (part.type === "input_image") return part.image_url ?? "";
    if (part.type === "input_file") return part.file?.file_id ?? "";
    return "";
  }).join("");
}
