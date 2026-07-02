import type { ChatCompletionChunk } from "../openai/types.ts";

export interface ConversationLifecycleOptions<TConversation> {
  createConversation: () => Promise<TConversation> | TConversation;
  cleanupConversation?: (
    conversation: TConversation,
  ) => Promise<void> | void;
  onConversationCreated?: (conversation: TConversation) => Promise<void> | void;
}

export interface ConversationCompletionOptions<TConversation>
  extends ConversationLifecycleOptions<TConversation> {
  createCompletion: (
    conversation: TConversation,
  ) => Promise<ChatCompletionChunk> | ChatCompletionChunk;
}

export interface ConversationStreamOptions<TConversation>
  extends ConversationLifecycleOptions<TConversation> {
  createStream: (
    conversation: TConversation,
  ) => Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array>;
}

export async function runConversationCompletion<TConversation>(
  options: ConversationCompletionOptions<TConversation>,
): Promise<ChatCompletionChunk> {
  const conversation = await options.createConversation();
  await options.onConversationCreated?.(conversation);

  try {
    return await options.createCompletion(conversation);
  } finally {
    await options.cleanupConversation?.(conversation);
  }
}

export async function runConversationStream<TConversation>(
  options: ConversationStreamOptions<TConversation>,
): Promise<ReadableStream<Uint8Array>> {
  const conversation = await options.createConversation();
  await options.onConversationCreated?.(conversation);

  try {
    const stream = await options.createStream(conversation);
    return options.cleanupConversation
      ? withStreamFinalizer(
        stream,
        () => options.cleanupConversation?.(conversation),
      )
      : stream;
  } catch (error) {
    await options.cleanupConversation?.(conversation);
    throw error;
  }
}

export function withStreamFinalizer(
  stream: ReadableStream<Uint8Array>,
  finalizer: () => Promise<void> | void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let finalized = false;

  const finalizeOnce = async () => {
    if (finalized) return;
    finalized = true;
    await finalizer();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await finalizeOnce();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        await finalizeOnce();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await finalizeOnce();
      }
    },
  });
}
