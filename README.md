# chat-base

`chat-base` is a Deno-first base library for OpenAI-compatible chat API
wrappers. It provides the shared server, stream, type, and utility layers used
to build provider adapters without copying request and SSE boilerplate.

Current package: `@rethinkos/chat-base@0.2.0`

## Layers

- `core`: provider abstraction, Hono server wrapper, auth helpers, API errors,
  chat config strategy.
- `openai`: OpenAI-compatible request/response types and response builders.
- `stream`: SSE helpers, OpenAI stream writer, inheritable EventSource
  transformer.
- `tools`: message utilities, JSON extraction/repair, file/base64 helpers, tool
  calling protocols.
- `adapters`: compatibility adapters such as Responses API input/output
  conversion.

## Usage

```ts
import {
  BaseChatProvider,
  bearerToken,
  ChatApiServer,
  invalidRequestError,
  ModelFlagChatConfigStrategy,
} from "@rethinkos/chat-base";

class ExampleProvider extends BaseChatProvider<string> {
  readonly name = "example";
  private readonly config = new ModelFlagChatConfigStrategy({
    defaultModel: "example",
  });

  authenticate(headers: Headers): string {
    const token = bearerToken(headers.get("authorization"));
    if (!token) throw invalidRequestError("need token", "missing_token");
    return token;
  }

  buildConfig(body) {
    return this.config.build({
      model: body.model,
      stream: body.stream,
      messages: body.messages,
      responseFormat: body.response_format,
      tools: body.tools,
      toolChoice: body.tool_choice,
    });
  }

  async createChatCompletion(input) {
    throw new Error("not implemented");
  }

  async createChatCompletionStream(input) {
    throw new Error("not implemented");
  }

  listModels() {
    return { data: [{ id: "example" }] };
  }
}

const server = new ChatApiServer({ provider: new ExampleProvider() });
server.listen();
```

## Stream Adapter

```ts
import { EventSourceOpenAITransformer } from "@rethinkos/chat-base/stream";

class ExampleStream extends EventSourceOpenAITransformer {
  protected handleEvent(event, writer) {
    if (event.data === "[DONE]") {
      this.finish(writer);
      return;
    }
    const chunk = JSON.parse(event.data);
    writer.write({ content: chunk.text ?? "" });
  }
}
```

## Development

```bash
deno task check
deno publish --dry-run
```
