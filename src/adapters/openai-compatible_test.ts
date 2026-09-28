import {
  buildOpenAICompatibleChatBody,
  ChatApiServer,
  createOpenAICompatibleProvider,
} from "../../mod.ts";
import { assertEquals } from "jsr:@std/assert@^1.0.14";
import type { ChatMessage } from "../../mod.ts";

const imageMessages: ChatMessage[] = [{
  role: "user",
  content: [
    { type: "text", text: "Read the formula" },
    {
      type: "image_url",
      image_url: { url: "data:image/png;base64,TEST", detail: "high" },
    },
    {
      type: "image_url",
      image_url: { url: "https://example.com/formula.png" },
    },
  ],
}];

Deno.test("OpenAI-compatible requests preserve multimodal content in every schema mode", () => {
  for (const jsonSchemaMode of ["native", "json_object", "prompt"] as const) {
    const body = buildOpenAICompatibleChatBody({
      model: "deepseek-flash",
      messages: imageMessages,
      jsonSchemaMode,
    });
    assertEquals(body.messages, imageMessages);
  }
});

Deno.test("schema prompts preserve images, append instructions, and do not mutate input", () => {
  const before = structuredClone(imageMessages);
  const body = buildOpenAICompatibleChatBody({
    model: "deepseek-flash",
    messages: imageMessages,
    jsonSchemaMode: "prompt",
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "formula",
        schema: { type: "object", properties: { latex: { type: "string" } } },
      },
    },
  });
  const content = body.messages[0].content;
  if (!Array.isArray(content)) {
    throw new Error("multimodal content was flattened");
  }
  assertEquals(content.slice(0, 3), imageMessages[0].content);
  assertEquals(content[3].type, "text");
  assertEquals(content[3].text?.includes('"latex"'), true);
  assertEquals(body.response_format, undefined);
  assertEquals(imageMessages, before);
});

Deno.test("buildOpenAICompatibleChatBody forwards parallel_tool_calls", () => {
  const body = buildOpenAICompatibleChatBody({
    model: "test",
    messages: [{ role: "user", content: "hi" }],
    parallelToolCalls: false,
  });

  assertEquals(body.parallel_tool_calls, false);
});

for (const stream of [false, true]) {
  Deno.test(`official proxy preserves request options (stream=${stream})`, async () => {
    let forwarded: Record<string, unknown> = {};
    const provider = createOpenAICompatibleProvider({
      providerName: "test",
      baseUrl: "https://example.com",
      defaultModel: "test",
      fetch: ((_url, init) => {
        forwarded = JSON.parse((init as { body?: string })?.body ?? "{}");
        return Promise.resolve(
          stream
            ? new Response("data: [DONE]\n\n", {
              headers: { "Content-Type": "text/event-stream" },
            })
            : Response.json({
              id: "test",
              object: "chat.completion",
              created: 0,
              model: "test",
              choices: [{
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              }],
            }),
        );
      }) as typeof fetch,
    });
    const server = new ChatApiServer({ provider });
    for (
      const thinkingOptions of [
        { reasoning_effort: "none" },
        { thinking: { type: "disabled" } },
        { reasoning_effort: "high" },
        {},
      ]
    ) {
      const extras = {
        ...thinkingOptions,
        temperature: 0,
        max_tokens: 1024,
        top_p: 0.8,
        stop: ["END"],
        stream_options: { include_usage: true },
        custom_option: false,
      };
      const response = await server.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "local-only",
            model: "test",
            messages: imageMessages,
            stream,
            ...extras,
          }),
        }),
      );
      assertEquals(response.status, 200);
      await response.text();
      assertEquals(forwarded, {
        model: "test",
        messages: imageMessages,
        stream,
        parallel_tool_calls: true,
        ...extras,
      });
    }
  });
}
