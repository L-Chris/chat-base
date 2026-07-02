import type {
  ChatMessage,
  FinishReason,
  ToolCall,
  Usage,
} from "../openai/types.ts";
import type {
  EventSourceMessage,
  EventSourceTransformerHooks,
} from "./event-source-transformer.ts";
import { JsonEventSourceOpenAITransformer } from "./event-source-transformer.ts";
import type { OpenAIStreamWriter } from "./openai-stream.ts";

export type StreamAction =
  | { type: "ignore" }
  | { type: "content"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "citations"; citations: unknown[] }
  | {
    type: "finish";
    finishReason?: Exclude<FinishReason, null>;
    content?: string;
    reasoningContent?: string;
    toolCalls?: ToolCall[];
    usage?: Usage;
  }
  | { type: "error"; message: string; errorType?: string; code?: string };

export type StreamActionResult =
  | StreamAction
  | StreamAction[]
  | null
  | undefined;

export interface MappedJsonTransformerOptions<TChunk> {
  model: string;
  messages: ChatMessage[];
  hooks?: EventSourceTransformerHooks;
  mapChunk: (
    chunk: TChunk,
    event: EventSourceMessage,
    writer: OpenAIStreamWriter,
  ) => StreamActionResult;
  shouldSkipEvent?: (event: EventSourceMessage) => boolean;
  handleMalformedEvent?: (
    event: EventSourceMessage,
    error: unknown,
    writer: OpenAIStreamWriter,
  ) => void;
}

export class MappedJsonEventSourceOpenAITransformer<
  TChunk,
> extends JsonEventSourceOpenAITransformer<TChunk> {
  constructor(
    response: Response,
    private readonly mappedOptions: MappedJsonTransformerOptions<TChunk>,
  ) {
    super(response, {
      model: mappedOptions.model,
      messages: mappedOptions.messages,
      hooks: mappedOptions.hooks,
    });
  }

  protected override shouldSkipEvent(event: EventSourceMessage): boolean {
    return this.mappedOptions.shouldSkipEvent?.(event) ?? false;
  }

  protected override handleMalformedEvent(
    event: EventSourceMessage,
    error: unknown,
    writer: OpenAIStreamWriter,
  ): void {
    this.mappedOptions.handleMalformedEvent?.(event, error, writer);
  }

  protected handleChunk(
    chunk: TChunk,
    event: EventSourceMessage,
    writer: OpenAIStreamWriter,
  ): void {
    const actions = this.mappedOptions.mapChunk(chunk, event, writer);
    if (!actions) return;
    const list = Array.isArray(actions) ? actions : [actions];
    for (const action of list) {
      this.applyAction(action, writer);
    }
  }

  private applyAction(action: StreamAction, writer: OpenAIStreamWriter): void {
    switch (action.type) {
      case "ignore":
        return;
      case "content":
        writer.write({ content: action.content });
        return;
      case "reasoning":
        writer.write({ reasoningContent: action.content });
        return;
      case "citations":
        writer.write({ citations: action.citations });
        return;
      case "error":
        writer.error(action.message, {
          type: action.errorType,
          code: action.code,
        });
        return;
      case "finish":
        this.finish(writer, {
          finishReason: action.finishReason,
          content: action.content,
          reasoningContent: action.reasoningContent,
          toolCalls: action.toolCalls,
          usage: action.usage,
        });
        return;
    }
  }
}
