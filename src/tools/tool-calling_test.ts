import {
  bytesToBase64,
  DelimitedToolCallBuffer,
  DelimitedToolProtocol,
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
