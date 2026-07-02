import type { ChatMessage, ChatMessagePart } from "../openai/types.ts";

export function messageContentToText(
  content: string | ChatMessagePart[] | null | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

export function messagesToText(messages: ChatMessage[]): string {
  return messages.map((message) => messageContentToText(message.content)).join(
    "",
  );
}

export function getLastUserMessage<T extends ChatMessage>(
  messages: T[],
): T | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

export function mapMessageContent<T extends ChatMessage>(
  message: T,
  mapper: (content: string) => string,
): T {
  if (typeof message.content !== "string") return message;
  return { ...message, content: mapper(message.content) };
}

export function extractFileUrlsFromMessages(messages: ChatMessage[]): string[] {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || !Array.isArray(lastMessage.content)) return [];

  const urls: string[] = [];
  for (const part of lastMessage.content) {
    if (part.type === "file" && typeof part.file_url?.url === "string") {
      urls.push(part.file_url.url);
    }
    if (part.type === "image_url" && typeof part.image_url?.url === "string") {
      urls.push(part.image_url.url);
    }
  }
  return urls;
}

export function formatMessageEnvelope(message: ChatMessage): string {
  return `<message>${message.role || "user"}\n${
    messageContentToText(message.content)
  }</message>\n`;
}

export function buildHistoryText(messages: ChatMessage[]): string | null {
  if (messages.length <= 1) return null;

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return null;

  const systemParts: string[] = [];
  const historyParts: string[] = [];

  messages.forEach((message, index) => {
    const content = messageContentToText(message.content);
    if (!content) return;
    if (message.role === "system") systemParts.push(content);
    else if (index === lastUserIndex) return;
    else if (message.role === "user") historyParts.push(`[User]\n${content}`);
    else if (message.role === "assistant") {
      historyParts.push(`[Assistant]\n${content}`);
    } else if (message.role === "tool") {
      historyParts.push(
        `[Tool:${message.tool_call_id ?? "unknown"}]\n${content}`,
      );
    }
  });

  if (!systemParts.length && !historyParts.length) return null;

  const segments: string[] = [];
  if (systemParts.length) {
    segments.push(`[System]\n${systemParts.join("\n\n")}`);
  }
  if (historyParts.length) {
    segments.push(`[Conversation History]\n${historyParts.join("\n\n")}`);
  }
  return segments.join("\n\n---\n\n");
}
