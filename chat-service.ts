import type { OpenAI } from "./types.ts";
import { createParser } from 'eventsource-parser'
import { approximateTokenSize } from 'tokenx'
import { parseCredentials } from './utils.ts'
import { buildChatConfig } from './config.ts'

export abstract class BaseChatService {
  protected credentials: Record<string, string> = {}
  protected req!: Request
  protected streamController!: ReadableStreamDefaultController
  protected encoder: TextEncoder = new TextEncoder()
  protected decoder: TextDecoder = new TextDecoder()
  protected content = ''
  protected thinkingContent = ''
  protected config!: OpenAI.ChatConfig
  protected messages: OpenAI.Message[] = []
  protected callbacks: (() => void)[] = []

  private parser = createParser({
    onEvent: (e: EventSourceMessage) => {
      try {
        this.parse(e)
      } catch (err) {
        console.log('[chat-base] parse error:', err)
      }
    }
  })

  constructor () {}

  /**
   * Framework-agnostic entry point
   */
  async handleRequest(req: Request): Promise<Response> {
    this.req = req
    this.credentials = parseCredentials(req);

    if (!this.credentials.token) {
      return new Response(JSON.stringify({
        status: 500,
        message: 'need token'
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    }

    const body = await req.json();
    this.messages = body?.messages || [];

    if (!Array.isArray(this.messages) || this.messages.length === 0) {
      return new Response(JSON.stringify({
        status: 500,
        message: 'need message'
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    }

    this.config = this.parseChatConfig({
      chat_id: body.id,
      model: body.model,
      stream: body.stream,
      response_format: body.response_format,
      tools: body.tools,
      tool_choice: body.tool_choice,
      messages: this.messages
    });

    const stream = new ReadableStream({
      start: (controller) => {
        this.streamController = controller;
        this.createCompletion().catch(err => {
          console.error('[chat-base] Completion error:', err);
          this.send({ error: err.message });
          this.send({ done: true });
        });
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });
  }

  protected abstract createCompletion(): Promise<void>;
  protected abstract getModels(): OpenAI.Model[];
  protected abstract generateHeaders(): Record<string, string>;
  protected abstract parse(e: EventSourceMessage): void;
  protected abstract getChunkType(chunk: unknown): OpenAI.CHUNK_TYPE;

  protected abstract getModelFeatures(model: string): { thinking: boolean, searching: boolean };

  protected parseChatConfig(body: {
    stream?: boolean
    chat_id?: string
    response_format?: OpenAI.ChatConfig['response_format']
    model: string
    tools?: OpenAI.Tool[]
    tool_choice?: OpenAI.ToolChoice
    messages: OpenAI.Message[]
  }): OpenAI.ChatConfig {
    return buildChatConfig({
      ...body,
      defaultStream: true,
      modelFeatureResolver: model => this.getModelFeatures(model)
    })
  }

  protected async readUpstream(res: Response) {
    if (!this.streamController) return
    try {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.indexOf('text/event-stream') < 0) {
        const body = await res.text()
        this.send({ error: contentType === 'text/html' ? 'rejected by server' : body })
        this.send({ done: true })
        return
      }

      const reader = res.body!.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break;
        const decodedValue = this.decoder.decode(value)
        this.parser.feed(decodedValue)
      }
      this.send({ done: true })
    } catch (err) {
      console.log('[chat-base] read error:', err)
      this.send({ error: err instanceof Error ? err.message : 'unknown error' })
      this.send({ done: true })
    }
  }

  protected send(params: OpenAI.SendParams) {
    if (!this.streamController) return;

    this.thinkingContent += params.reasoning_content || ''
    this.content += params.content || ''

    const message: OpenAI.CompletionChunk = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      model: this.config.model_name,
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: params.content || '',
          reasoning_content: params.reasoning_content || ''
        },
        finish_reason: null
      }],
      citations: params.citations || [],
      created: Math.trunc(Date.now() / 1000)
    }

    if (params.error) {
      message.error = {
        message: params.error,
        type: 'server error'
      }
      this.enqueue(message);
      return
    }

    if (params.done) {
      const prompt_tokens = approximateTokenSize(
        this.messages.reduce((acc, cur) =>
          acc + (Array.isArray(cur.content)
            ? cur.content.map(c => c.text).join('')
            : cur.content),
          ''
        )
      )
      const completion_tokens = approximateTokenSize(this.thinkingContent + this.content)
      message.usage = {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens
      }
      message.choices[0].finish_reason = params.finish_reason || 'stop';
      message.choices[0].delta = {}; // End chunk often has empty delta

      this.enqueue(message);
      this.streamController.enqueue(this.encoder.encode(`data: [DONE]\n\n`))
      this.streamController.close()
      this.callbacks.forEach(cb => cb())
      return
    }

    this.enqueue(message);
  }

  private enqueue(message: any) {
    try {
      this.streamController.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
    } catch (e) {
      console.error('[chat-base] enqueue error:', e);
    }
  }

  onDone(cb: () => void) {
    this.callbacks.push(cb)
  }
}

export interface EventSourceMessage {
  data: string
  event?: string
  id?: string
}