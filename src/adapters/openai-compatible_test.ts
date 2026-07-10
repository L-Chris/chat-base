import { buildOpenAICompatibleChatBody } from "../../mod.ts";
import { assertEquals } from "jsr:@std/assert@^1.0.14";

Deno.test("buildOpenAICompatibleChatBody forwards parallel_tool_calls", () => {
  const body = buildOpenAICompatibleChatBody({
    model: "test",
    messages: [{ role: "user", content: "hi" }],
    parallelToolCalls: false,
  });

  assertEquals(body.parallel_tool_calls, false);
});
