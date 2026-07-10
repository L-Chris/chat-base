import { ModelFlagChatConfigStrategy } from "../../mod.ts";
import { assertEquals } from "jsr:@std/assert@^1.0.14";

Deno.test("ModelFlagChatConfigStrategy defaults parallel tool calls to true", () => {
  const strategy = new ModelFlagChatConfigStrategy({ defaultModel: "test" });
  const input = {
    model: "test",
    messages: [{ role: "user" as const, content: "hi" }],
  };

  assertEquals(strategy.build(input).parallelToolCalls, true);
  assertEquals(
    strategy.build({ ...input, parallelToolCalls: false }).parallelToolCalls,
    false,
  );
});
