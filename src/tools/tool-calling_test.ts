import {
  BracketToolProtocol,
  bytesToBase64,
  DelimitedToolCallBuffer,
  DelimitedToolProtocol,
  mergeMessages,
  type ToolCallDelimiterMarkers,
} from "../../mod.ts";
import { assert, assertEquals } from "jsr:@std/assert@^1.0.14";

const markers: ToolCallDelimiterMarkers = {
  TC_START: "<tc>",
  TC_END: "</tc>",
  NAME_START: "<name>",
  NAME_END: "</name>",
  ARGS_START: "<args>",
  ARGS_END: "</args>",
  RESULT_START: "<result>",
  RESULT_END: "</result>",
};

Deno.test("bytesToBase64 encodes large byte arrays", () => {
  const bytes = new TextEncoder().encode("hello world".repeat(10000));
  assertEquals(bytesToBase64(bytes), btoa("hello world".repeat(10000)));
});

Deno.test("DelimitedToolCallBuffer streams text and tool calls", () => {
  const buffer = new DelimitedToolCallBuffer(
    new DelimitedToolProtocol(markers),
  );

  assertEquals(buffer.push("hello <t"), {
    content: ["hello "],
    toolCalls: [],
  });
  assertEquals(buffer.push('c><name>search</name><args>{"q":"deno"}'), {
    content: [],
    toolCalls: [],
  });
  const result = buffer.push("</args></tc> world");
  assertEquals(result.content, [" world"]);
  assertEquals(result.toolCalls.length, 1);
  assert(result.toolCalls[0].id.startsWith("call-"));
  assertEquals(
    { ...result.toolCalls[0], id: "call-id" },
    {
      id: "call-id",
      type: "function",
      function: { name: "search", arguments: '{"q":"deno"}' },
      index: 0,
    },
  );
  assertEquals(buffer.flush(), { content: [], toolCalls: [] });
});

Deno.test("DelimitedToolCallBuffer flushes incomplete tool call as text", () => {
  const buffer = new DelimitedToolCallBuffer(
    new DelimitedToolProtocol(markers),
  );

  assertEquals(buffer.push("before <tc><name>broken"), {
    content: ["before "],
    toolCalls: [],
  });
  assertEquals(buffer.flush(), {
    content: ["<tc><name>broken"],
    toolCalls: [],
  });
});

Deno.test("tool protocols describe serial and parallel tool calls", () => {
  const tools = [{ type: "function" as const, function: { name: "search" } }];

  assert(
    new DelimitedToolProtocol(markers).buildSystemPrompt(tools, "auto", true)
      .includes("Repeat the block for each tool call"),
  );
  assert(
    new BracketToolProtocol().buildSystemPrompt(tools, "auto", false)
      .includes("at most one tool"),
  );
});

Deno.test("mergeMessages passes parallel tool call preference to its prompt", () => {
  const messages = mergeMessages(
    [{ role: "user", content: "hi" }],
    {
      tools: [{ type: "function", function: { name: "search" } }],
      parallelToolCalls: false,
    },
  );

  assert(
    typeof messages[0].content === "string" &&
      messages[0].content.includes("at most one tool"),
  );
});

Deno.test("DelimitedToolCallBuffer preserves parallel tool calls", () => {
  const buffer = new DelimitedToolCallBuffer(
    new DelimitedToolProtocol(markers),
  );

  const result = buffer.push(
    '<tc><name>search</name><args>{"q":"deno"}</args></tc>' +
      '<tc><name>lookup</name><args>{"id":1}</args></tc>',
  );

  assertEquals(
    result.toolCalls.map((call) => ({
      name: call.function.name,
      index: call.index,
    })),
    [
      { name: "search", index: 0 },
      { name: "lookup", index: 1 },
    ],
  );
});
