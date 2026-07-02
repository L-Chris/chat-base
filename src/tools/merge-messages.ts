import type {
  ChatMessage,
  ChatMessagePart,
  Tool,
  ToolChoice,
} from "../openai/types.ts";
import { BracketToolProtocol } from "./tool-calling.ts";
import { messageContentToText } from "./messages.ts";

export type ToolPromptMode = "none" | "when-missing-system" | "append-first";

export interface MergeMessagesOptions<
  TAttachment = unknown,
  TMessage extends { role: ChatMessage["role"]; content: unknown } =
    ChatMessage,
> {
  attachments?: TAttachment[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  toolPromptMode?: ToolPromptMode;
  buildToolPrompt?: (tools: Tool[], toolChoice?: ToolChoice) => string;
  buildUserContent?: (content: string, attachments: TAttachment[]) =>
    | TMessage["content"]
    | ChatMessage["content"];
  mapSystemMessage?: (message: ChatMessage) => TMessage;
  createMessage?: (
    role: ChatMessage["role"],
    content: unknown,
  ) => TMessage;
  formatMessage?: (message: ChatMessage, content: string) => string;
  formatToolResult?: (
    message: ChatMessage,
    toolName: string,
    content: string,
  ) => string;
  skipAssistantToolCalls?: boolean;
}

export function mergeMessages<
  TAttachment = unknown,
  TMessage extends { role: ChatMessage["role"]; content: unknown } =
    ChatMessage,
>(
  messages: ChatMessage[],
  options: MergeMessagesOptions<TAttachment, TMessage> = {},
): TMessage[] {
  const attachments = options.attachments ?? [];
  const toolPromptMode = options.toolPromptMode ?? "when-missing-system";
  const skipAssistantToolCalls = options.skipAssistantToolCalls ?? true;
  const createMessage = (options.createMessage ?? defaultCreateMessage) as (
    role: ChatMessage["role"],
    content: unknown,
  ) => TMessage;

  const systemMessages = messages
    .filter((message) => message.role === "system")
    .map((message) =>
      options.mapSystemMessage?.(message) ??
        createMessage("system", message.content)
    );

  const toolPrompt = buildToolPrompt(
    options.tools,
    options.toolChoice,
    options,
  );
  if (
    toolPrompt && toolPromptMode === "when-missing-system" &&
    !systemMessages.length
  ) {
    systemMessages.push(createMessage("system", toolPrompt));
  } else if (toolPrompt && toolPromptMode === "append-first") {
    if (systemMessages.length) {
      const first = systemMessages[0];
      systemMessages[0] = {
        ...first,
        content: `${
          messageContentToText(first.content as ChatMessage["content"])
        }\n\n${toolPrompt}`,
      };
    } else {
      systemMessages.push(createMessage("system", toolPrompt));
    }
  }

  const content = messages
    .filter((message) => message.role !== "system")
    .reduce((previous, message) => {
      if (
        skipAssistantToolCalls && message.role === "assistant" &&
        message.tool_calls?.length
      ) {
        return previous;
      }

      if (message.role === "tool") {
        const toolName = findToolName(messages, message);
        return previous + (options.formatToolResult ??
          defaultFormatToolResult)(
            message,
            toolName,
            messageContentToText(message.content),
          );
      }

      if (Array.isArray(message.content)) {
        return message.content.reduce((current, part) => {
          if (part.type !== "text") return current;
          return current + (options.formatMessage ?? defaultFormatMessage)(
            message,
            part.text ?? "",
          );
        }, previous);
      }

      return previous + (options.formatMessage ?? defaultFormatMessage)(
        message,
        messageContentToText(message.content),
      );
    }, "");

  const userContent = options.buildUserContent
    ? options.buildUserContent(content, attachments)
    : content;

  return [
    ...systemMessages,
    createMessage("user", userContent),
  ];
}

function buildToolPrompt(
  tools: Tool[] | undefined,
  toolChoice: ToolChoice | undefined,
  options: {
    toolPromptMode?: ToolPromptMode;
    buildToolPrompt?: (tools: Tool[], toolChoice?: ToolChoice) => string;
  },
): string {
  const items = tools ?? [];
  if (!items.length || options.toolPromptMode === "none") return "";
  return (options.buildToolPrompt ??
    ((promptTools, choice) =>
      new BracketToolProtocol().buildSystemPrompt(promptTools, choice)))(
      items,
      toolChoice,
    );
}

function findToolName(messages: ChatMessage[], message: ChatMessage): string {
  const toolCalls =
    messages.find((item) =>
      item.role === "assistant" && item.tool_calls?.length
    )?.tool_calls ?? [];
  return toolCalls.find((item) => item.id === message.tool_call_id)
    ?.function.name ?? message.tool_call_id ?? "unknown";
}

function defaultFormatMessage(message: ChatMessage, content: string): string {
  return `<message>${message.role || "user"}\n${content}</message>\n`;
}

function defaultFormatToolResult(
  _message: ChatMessage,
  toolName: string,
  content: string,
): string {
  return `<message>user\n[ToolResults]\n[Result:${toolName}]\n[ToolResult]\n${content}\n[/ToolResult]\n[/Result]\n[/ToolResults]</message>\n`;
}

function defaultCreateMessage<
  TMessage extends {
    role: ChatMessage["role"];
    content: unknown;
  },
>(
  role: ChatMessage["role"],
  content: string | ChatMessagePart[],
): TMessage {
  return { role, content } as TMessage;
}
