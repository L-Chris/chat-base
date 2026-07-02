import type { ChatMessage, ChatMessagePart } from "../openai/types.ts";
import { messageContentToText } from "./messages.ts";
import { mergeMessages, type MergeMessagesOptions } from "./merge-messages.ts";

export interface ProviderTextMessage {
  role: ChatMessage["role"];
  content: string;
  [key: string]: unknown;
}

export function toTextMessage<
  T extends ProviderTextMessage = ProviderTextMessage,
>(
  message: ChatMessage,
  extra: Record<string, unknown> = {},
): T {
  return {
    role: message.role,
    content: messageContentToText(message.content),
    ...extra,
  } as T;
}

export function toTextMessages<
  T extends ProviderTextMessage = ProviderTextMessage,
>(
  messages: ChatMessage[],
): T[] {
  return messages.map((message) => toTextMessage<T>(message));
}

export function lastUserMessageOnly<
  T extends ProviderTextMessage = ProviderTextMessage,
>(
  messages: ChatMessage[],
  options: {
    createMessage?: (message: ChatMessage, content: string) => T;
  } = {},
): T[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const content = messageContentToText(message.content);
    return [
      options.createMessage?.(message, content) ??
        ({ role: "user", content } as T),
    ];
  }
  return toTextMessages<T>(messages);
}

export function envelopeMessages<
  TAttachment = unknown,
  TMessage extends { role: ChatMessage["role"]; content: unknown } =
    ChatMessage,
>(
  messages: ChatMessage[],
  options: MergeMessagesOptions<TAttachment, TMessage> = {},
): TMessage[] {
  return mergeMessages(messages, options);
}

export function textPartsToText(
  content: string | ChatMessagePart[] | null | undefined,
  separator = "",
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(separator);
}
