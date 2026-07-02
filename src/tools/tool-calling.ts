import type {
  ChatMessage,
  Tool,
  ToolCall,
  ToolChoice,
} from "../openai/types.ts";
import { createId } from "./ids.ts";
import { extractJsonFromContent } from "./json.ts";
import { messageContentToText } from "./messages.ts";

export interface ToolCallDelimiterMarkers {
  TC_START: string;
  TC_END: string;
  NAME_START: string;
  NAME_END: string;
  ARGS_START: string;
  ARGS_END: string;
  RESULT_START: string;
  RESULT_END: string;
}

export interface ToolCallParseResult {
  toolCalls: ToolCall[];
  cleanContent: string;
}

export interface ToolCallProtocol {
  parse(content: string): ToolCallParseResult;
}

export interface ToolCallBufferResult {
  content: string[];
  toolCalls: ToolCall[];
}

const DELIMITER_SETS = [
  { open: "༒", close: "༒", mid: "࿇" },
  { open: "꧁", close: "꧂", mid: "꧔" },
  { open: "Ꭲ", close: "Ꭲ", mid: "Ꮣ" },
  { open: "ꆉ", close: "ꆉ", mid: "ꉰ" },
  { open: "꩜", close: "꩜", mid: "꩟" },
  { open: "ꓸ", close: "ꓸ", mid: "ꓹ" },
];

const SUFFIX_POOL = [
  "龘",
  "靀",
  "齉",
  "龾",
  "龗",
  "龖",
  "鱻",
  "鱙",
  "麣",
  "虪",
  "爨",
  "癥",
  "驫",
  "鬱",
  "靊",
  "齥",
  "鸑",
  "鸓",
  "麷",
  "鼐",
];

export class DelimitedToolProtocol {
  readonly markers: ToolCallDelimiterMarkers;

  constructor(markers: ToolCallDelimiterMarkers = createToolCallMarkers()) {
    this.markers = markers;
  }

  buildSystemPrompt(tools: Tool[], toolChoice?: ToolChoice): string {
    if (!tools.length) return "";

    const descriptions = tools.map((tool) => {
      const fn = tool.function;
      return `- **${fn.name}**: ${fn.description || ""}\n  Parameters: ${
        JSON.stringify(fn.parameters ?? {})
      }`;
    }).join("\n");

    const required = toolChoice === "required"
      ? "\nYou must call at least one tool before responding to the user."
      : "";

    return `## Tool Calling

You have access to the following tools:
${descriptions}

When a tool is needed, output ONLY this block and stop:

${this.markers.TC_START}
${this.markers.NAME_START}function_name${this.markers.NAME_END}
${this.markers.ARGS_START}{"param":"value"}${this.markers.ARGS_END}
${this.markers.TC_END}

Rules:
- Never invent tool results.
- Never mix normal prose with a tool call block.
- After ${this.markers.TC_END}, stop generating.${required}`;
  }

  serializeToolCall(toolCall: ToolCall): string {
    const fn = toolCall.function;
    return `${this.markers.TC_START}\n${this.markers.NAME_START}${fn.name}${this.markers.NAME_END}\n${this.markers.ARGS_START}${fn.arguments}${this.markers.ARGS_END}\n${this.markers.TC_END}`;
  }

  serializeToolResult(message: ChatMessage): string {
    const content = messageContentToText(message.content);
    const name = message.tool_call_id ?? "function";
    return `${this.markers.RESULT_START}[${name}]\n${content}\n${this.markers.RESULT_END}`;
  }

  parse(content: string): ToolCallParseResult {
    const regex = new RegExp(
      `${escapeRegex(this.markers.TC_START)}\\s*` +
        `${escapeRegex(this.markers.NAME_START)}([\\s\\S]*?)${
          escapeRegex(this.markers.NAME_END)
        }\\s*` +
        `${escapeRegex(this.markers.ARGS_START)}([\\s\\S]*?)${
          escapeRegex(this.markers.ARGS_END)
        }\\s*` +
        `${escapeRegex(this.markers.TC_END)}`,
      "g",
    );

    const toolCalls: ToolCall[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1].trim();
      const args = normalizeToolArguments(match[2].trim());
      if (!name || args === null) continue;
      toolCalls.push({
        id: createId("call"),
        type: "function",
        function: { name, arguments: args },
      });
    }

    return {
      toolCalls,
      cleanContent: content.replace(regex, "").trim(),
    };
  }
}

export class BracketToolProtocol {
  buildSystemPrompt(tools: Tool[], toolChoice?: ToolChoice): string {
    if (!tools.length) return "";

    const lines = [
      "SYSTEM INTERFACE: You have access to these tools and must follow the tool call protocol exactly.",
    ];
    for (const tool of tools) {
      const fn = tool.function;
      lines.push(
        `Tool \`${fn.name}\`: ${fn.description || "No description provided."}`,
      );
      lines.push(
        `Arguments JSON schema: ${JSON.stringify(fn.parameters ?? {})}`,
      );
    }
    if (toolChoice === "required") {
      lines.push(
        "You must call at least one tool before responding to the user.",
      );
    }
    lines.push(`[ToolCalls]
[Call:tool_name]
[CallParameter:parameter_name]
\`\`\`
value
\`\`\`
[/CallParameter]
[/Call]
[/ToolCalls]`);
    return lines.join("\n");
  }

  parse(content: string): ToolCallParseResult {
    const block = content.match(/\[ToolCalls\]([\s\S]*?)\[\/ToolCalls\]/);
    if (!block) return { toolCalls: [], cleanContent: content.trim() };

    const toolCalls: ToolCall[] = [];
    const callRegex = /\[Call:([^\]]+)\]([\s\S]*?)\[\/Call\]/g;
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callRegex.exec(block[1])) !== null) {
      const name = callMatch[1].trim();
      const args: Record<string, unknown> = {};
      const paramRegex =
        /\[CallParameter:([^\]]+)\]([\s\S]*?)\[\/CallParameter\]/g;
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = paramRegex.exec(callMatch[2])) !== null) {
        args[paramMatch[1].trim()] = stripParamFences(paramMatch[2]);
      }
      toolCalls.push({
        id: createId("call"),
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });
    }

    return {
      toolCalls,
      cleanContent: content.replace(block[0], "").trim(),
    };
  }
}

export class DelimitedToolCallBuffer {
  private pendingText = "";
  private bufferingTool = false;
  private toolBuffer = "";
  private nextIndex = 0;

  constructor(private readonly protocol: DelimitedToolProtocol) {}

  push(incoming: string): ToolCallBufferResult {
    const output = emptyBufferResult();
    this.pushInto(incoming, output);
    return output;
  }

  flush(): ToolCallBufferResult {
    const output = emptyBufferResult();
    if (this.pendingText && !this.bufferingTool) {
      this.pushInto("", output, true);
    }
    if (this.bufferingTool) {
      this.finalizeToolCall(output, false);
    }
    return output;
  }

  private pushInto(
    incoming: string,
    output: ToolCallBufferResult,
    forceFlush = false,
  ): void {
    const markers = this.protocol.markers;

    if (this.bufferingTool) {
      this.toolBuffer += incoming;
      const endIndex = this.toolBuffer.indexOf(markers.TC_END);
      if (endIndex !== -1) {
        const afterEnd = this.toolBuffer.slice(
          endIndex + markers.TC_END.length,
        );
        this.toolBuffer = this.toolBuffer.slice(0, endIndex);
        this.finalizeToolCall(output, true);
        if (afterEnd) this.pushInto(afterEnd, output, forceFlush);
      }
      return;
    }

    const combined = this.pendingText + incoming;
    const startIndex = combined.indexOf(markers.TC_START);

    if (startIndex === -1) {
      const safeEnd = forceFlush
        ? combined.length
        : findPartialMatchEndIndex(combined, markers.TC_START);
      if (safeEnd > 0) output.content.push(combined.slice(0, safeEnd));
      this.pendingText = combined.slice(safeEnd);
      return;
    }

    if (startIndex > 0) output.content.push(combined.slice(0, startIndex));
    this.pendingText = "";
    this.bufferingTool = true;
    this.toolBuffer = combined.slice(startIndex + markers.TC_START.length);
    this.pushInto("", output, forceFlush);
  }

  private finalizeToolCall(
    output: ToolCallBufferResult,
    completed: boolean,
  ): void {
    const markers = this.protocol.markers;
    const { cleanContent, toolCalls } = this.protocol.parse(
      markers.TC_START + this.toolBuffer + (completed ? markers.TC_END : ""),
    );

    if (toolCalls.length) {
      if (cleanContent) output.content.push(cleanContent);
      output.toolCalls.push(
        ...toolCalls.map((toolCall) => ({
          ...toolCall,
          index: this.nextIndex++,
        })),
      );
    } else {
      output.content.push(
        markers.TC_START + this.toolBuffer + (completed ? markers.TC_END : ""),
      );
    }

    this.bufferingTool = false;
    this.toolBuffer = "";
  }
}

export function createToolCallMarkers(): ToolCallDelimiterMarkers {
  const set = pick(DELIMITER_SETS);
  const s1 = pick(SUFFIX_POOL);
  const s2 = pick(SUFFIX_POOL);
  return {
    TC_START: `${set.open}${s1}ᐅ`,
    TC_END: `ᐊ${s1}${set.close}`,
    NAME_START: `${set.mid}▸`,
    NAME_END: `◂${set.mid}`,
    ARGS_START: `${set.mid}▹`,
    ARGS_END: `◃${set.mid}`,
    RESULT_START: `${set.open}${s2}⟫`,
    RESULT_END: `⟪${s2}${set.close}`,
  };
}

export function findPartialMatchEndIndex(text: string, marker: string): number {
  for (let i = marker.length - 1; i > 0; i--) {
    if (text.endsWith(marker.slice(0, i))) return text.length - i;
  }
  return text.length;
}

function normalizeToolArguments(value: string): string | null {
  const parsed = extractJsonFromContent(value);
  if (parsed === null) return null;
  return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
}

function stripParamFences(value: string): string {
  let output = value.trim();
  const match = output.match(/^(`{3,})/);
  if (!match) return output;

  const fence = match[1];
  const newlineIndex = output.indexOf("\n");
  output = newlineIndex >= 0
    ? output.slice(newlineIndex + 1)
    : output.slice(fence.length);
  if (output.endsWith(`\n${fence}`)) {
    output = output.slice(0, -fence.length - 1);
  } else if (output.endsWith(fence)) {
    output = output.slice(0, -fence.length);
  }
  return output.trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function emptyBufferResult(): ToolCallBufferResult {
  return { content: [], toolCalls: [] };
}
