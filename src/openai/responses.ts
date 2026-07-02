import type {
  ChatCompletionChunk,
  ChatMessage,
  ResponseFormat,
  Tool,
  Usage,
} from "./types.ts";
import { createId, nowUnixSeconds } from "../tools/ids.ts";
import { extractJsonFromContent } from "../tools/json.ts";
import {
  BracketToolProtocol,
  type ToolCallProtocol,
} from "../tools/tool-calling.ts";

export function createChatChunk(params: {
  model: string;
  id?: string;
  created?: number;
  content?: string;
  reasoningContent?: string;
  citations?: unknown[];
}): ChatCompletionChunk {
  return {
    id: params.id ?? createId("chatcmpl"),
    object: "chat.completion.chunk",
    created: params.created ?? nowUnixSeconds(),
    model: params.model,
    choices: [{
      index: 0,
      delta: {
        role: "assistant",
        content: params.content ?? "",
        reasoning_content: params.reasoningContent ?? "",
      },
      finish_reason: null,
    }],
    citations: params.citations ?? [],
  };
}

export function createDoneChunk(params: {
  model: string;
  id?: string;
  created?: number;
  content?: string;
  reasoningContent?: string;
  usage?: Usage;
  finishReason?: "stop" | "tool_calls" | "length" | "content_filter";
}): ChatCompletionChunk {
  return {
    id: params.id ?? createId("chatcmpl"),
    object: "chat.completion.chunk",
    created: params.created ?? nowUnixSeconds(),
    model: params.model,
    choices: [{
      index: 0,
      delta: {
        role: "assistant",
        content: params.content ?? "",
        reasoning_content: params.reasoningContent ?? "",
      },
      finish_reason: params.finishReason ?? "stop",
    }],
    usage: params.usage,
    citations: [],
  };
}

export function createErrorChunk(params: {
  model: string;
  message: string;
  type?: string;
  code?: string;
  id?: string;
  created?: number;
}): ChatCompletionChunk {
  return {
    id: params.id ?? createId("chatcmpl"),
    object: "chat.completion.chunk",
    created: params.created ?? nowUnixSeconds(),
    model: params.model,
    choices: [{
      index: 0,
      delta: { role: "assistant", content: "" },
      finish_reason: null,
    }],
    citations: [],
    error: {
      message: params.message,
      type: params.type ?? "server_error",
      code: params.code,
    },
  };
}

export function createChatCompletion(params: {
  model: string;
  content: string;
  reasoningContent?: string;
  usage: Usage;
  id?: string;
  created?: number;
  finishReason?: "stop" | "tool_calls" | "length" | "content_filter";
  toolCalls?: ChatCompletionChunk["choices"][number]["message"] extends infer M
    ? M extends { tool_calls?: infer T } ? T
    : never
    : never;
  citations?: unknown[];
}): ChatCompletionChunk {
  return {
    id: params.id ?? createId("chatcmpl"),
    object: "chat.completion",
    created: params.created ?? nowUnixSeconds(),
    model: params.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: params.content,
        reasoning_content: params.reasoningContent,
        tool_calls: params.toolCalls,
      },
      finish_reason: params.finishReason ?? "stop",
    }],
    usage: params.usage,
    citations: params.citations ?? [],
  };
}

export function normalizeResponseFormat(
  responseFormat?: ResponseFormat,
): ResponseFormat {
  return responseFormat?.type ? responseFormat : { type: "text" };
}

export interface ChatCompletionNormalizationOptions {
  responseFormat?: ResponseFormat;
  tools?: Tool[];
  parseTools?: boolean;
  extractJson?: boolean;
  toolProtocol?: ToolCallProtocol;
}

export function normalizeChatCompletionResponse<T extends ChatCompletionChunk>(
  message: T,
  options: ChatCompletionNormalizationOptions = {},
): T {
  const choice = message.choices[0];
  if (!choice?.message) return message;

  const shouldExtractJson = options.extractJson ??
    options.responseFormat?.type === "json_schema";
  if (shouldExtractJson) {
    const content = choice.message.content ?? "";
    const json = extractJsonFromContent(content);
    if (json !== null) {
      choice.message.content = JSON.stringify(json);
    }
  }

  const shouldParseTools = options.parseTools ?? !!options.tools?.length;
  if (shouldParseTools && options.tools?.length) {
    const protocol = options.toolProtocol ?? new BracketToolProtocol();
    const { cleanContent, toolCalls } = protocol.parse(
      choice.message.content ?? "",
    );
    choice.message.content = cleanContent;
    if (toolCalls.length) {
      choice.message.tool_calls = toolCalls;
      choice.finish_reason = "tool_calls";
    }
  }

  return message;
}

export function normalizeJsonSchema(
  responseFormat?: ResponseFormat,
): Record<string, unknown> | null {
  if (!responseFormat || responseFormat.type !== "json_schema") return null;
  const jsonSchema = responseFormat.json_schema;
  if (!jsonSchema || Array.isArray(jsonSchema)) return null;
  if (
    "schema" in jsonSchema && jsonSchema.schema &&
    typeof jsonSchema.schema === "object" && !Array.isArray(jsonSchema.schema)
  ) {
    return jsonSchema.schema as Record<string, unknown>;
  }
  return jsonSchema as Record<string, unknown>;
}

export function appendJsonSchemaPrompt<T extends ChatMessage>(
  messages: T[],
  responseFormat?: ResponseFormat,
  options: { mutate?: boolean; language?: "zh" | "en" } = {},
): T[] {
  const schema = normalizeJsonSchema(responseFormat);
  if (!schema && responseFormat?.type !== "json_object") return messages;

  const target = options.mutate ? messages : [...messages];
  const lastUserIndex = target.findLastIndex((message) =>
    message.role === "user"
  );
  if (lastUserIndex < 0) return target;

  const prompt = schema
    ? buildJsonSchemaPrompt(schema, options.language)
    : buildJsonObjectPrompt(options.language);
  const message = target[lastUserIndex];
  if (typeof message.content === "string") {
    target[lastUserIndex] = { ...message, content: message.content + prompt };
  }
  return target;
}

export function buildJsonSchemaPrompt(
  schema: Record<string, unknown>,
  language: "zh" | "en" = "zh",
): string {
  if (language === "en") {
    return `\nReturn only valid JSON matching this JSON Schema. Do not include Markdown or extra prose.\nSchema:\n${
      JSON.stringify(schema, null, 2)
    }`;
  }
  return `\n请严格按照以下 JSON Schema 返回有效 JSON。不要返回 Markdown 或额外说明，只返回 JSON 数据本身。\nSchema:\n${
    JSON.stringify(schema, null, 2)
  }`;
}

export function buildJsonObjectPrompt(language: "zh" | "en" = "zh"): string {
  return language === "en"
    ? "\nReturn only a valid JSON object. Do not include Markdown or extra prose."
    : "\n请返回有效 JSON object。不要返回 Markdown 或额外说明，只返回 JSON 对象本身。";
}
