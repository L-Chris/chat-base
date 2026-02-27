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
  protected nonStreamError = ''
  protected nonStreamFinishReason: 'stop' | 'tool_calls' = 'stop'
  protected nonStreamCitations: string[] = []

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
    this.content = ''
    this.thinkingContent = ''
    this.nonStreamError = ''
    this.nonStreamFinishReason = 'stop'
    this.nonStreamCitations = []
    this.credentials = parseCredentials(req);

    if (!this.credentials.token) {
      return this.jsonErrorResponse('need token', 500, 'auth error')
    }

    let body: any
    try {
      body = await req.json()
    } catch (_) {
      return this.jsonErrorResponse('invalid json body', 400, 'request error')
    }
    this.messages = body?.messages || [];

    if (!Array.isArray(this.messages) || this.messages.length === 0) {
      return this.jsonErrorResponse('need message', 500, 'request error')
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

    if (!this.config.stream) {
      return await this.consumeStreamToNonStreamResponse()
    }

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

  protected getUpstreamChatConfig(): OpenAI.ChatConfig {
    return {
      ...this.config,
      stream: true
    }
  }

  protected async readUpstream(res: Response) {
    try {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.indexOf('text/event-stream') < 0) {
        const body = await res.text()
        if (this.config.stream) {
          this.send({ error: contentType === 'text/html' ? 'rejected by server' : body })
          this.send({ done: true })
          return
        }

        if (contentType === 'text/html') {
          this.send({ error: 'rejected by server' })
          this.send({ done: true })
          return
        }

        const parsed = this.tryParseJSON(body)
        if (parsed?.error?.message) {
          this.send({ error: parsed.error.message })
          this.send({ done: true })
          return
        }

        const messageContent = parsed?.choices?.[0]?.message?.content
          || parsed?.choices?.[0]?.delta?.content
          || parsed?.output_text

        const reasoningContent = parsed?.choices?.[0]?.message?.reasoning_content
          || parsed?.choices?.[0]?.delta?.reasoning_content

        const citations = Array.isArray(parsed?.citations) ? parsed.citations : []

        if (typeof messageContent === 'string' && messageContent.length > 0) {
          this.send({ content: messageContent, reasoning_content: reasoningContent, citations })
        } else if (typeof body === 'string' && body.length > 0) {
          this.send({ content: body })
        }

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
    this.thinkingContent += params.reasoning_content || ''
    this.content += params.content || ''
    if (params.citations?.length) {
      this.nonStreamCitations = Array.from(new Set([...this.nonStreamCitations, ...params.citations]))
    }
    if (params.finish_reason) {
      this.nonStreamFinishReason = params.finish_reason
    }
    if (params.error) {
      this.nonStreamError = params.error
    }

    if (!this.config.stream) {
      return
    }

    if (!this.streamController) return;

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
      message.usage = this.getUsage()
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

  /**
   * 上游始终按流式消费，最后聚合成一次性 JSON（对齐 longcat consumeStreamToCompletion 思路）
   */
  private async consumeStreamToNonStreamResponse(): Promise<Response> {
    try {
      await this.createCompletion()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'completion error'
      return new Response(JSON.stringify({
        error: {
          message,
          type: 'server error'
        }
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      })
    }

    if (this.nonStreamError) {
      return new Response(JSON.stringify({
        error: {
          message: this.nonStreamError,
          type: 'server error'
        }
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      })
    }

    const usage = this.getUsage()
    const message: OpenAI.CompletionResponse = {
      id: `chatcmpl-${crypto.randomUUID()}`,
      model: this.config.model_name,
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: this.content,
          reasoning_content: this.thinkingContent || undefined
        },
        finish_reason: this.nonStreamFinishReason
      }],
      citations: this.nonStreamCitations,
      created: Math.trunc(Date.now() / 1000),
      usage
    }

    this.callbacks.forEach(cb => cb())
    return new Response(JSON.stringify(message), {
      headers: { 'content-type': 'application/json' }
    })
  }

  private getUsage() {
    const prompt_tokens = approximateTokenSize(
      this.messages.reduce((acc, cur) =>
        acc + (Array.isArray(cur.content)
          ? cur.content.map(c => c.text).join('')
          : cur.content),
        ''
      )
    )
    const completion_tokens = approximateTokenSize(this.thinkingContent + this.content)
    return {
      prompt_tokens,
      completion_tokens,
      total_tokens: prompt_tokens + completion_tokens
    }
  }

  private tryParseJSON(data: string): any {
    try {
      return JSON.parse(data)
    } catch (_) {
      return null
    }
  }

  private jsonErrorResponse(message: string, status = 500, type = 'server error') {
    return new Response(JSON.stringify({
      error: {
        message,
        type
      }
    }), {
      status,
      headers: { 'content-type': 'application/json' }
    })
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