import { createParser, type EventSourceParser } from 'eventsource-parser'
import { approximateTokenSize } from 'tokenx'
import type { OpenAI } from './types.ts'

export interface EventSourceMessage {
  data: string
  event?: string
  id?: string
}

export interface SendParams {
  content?: string
  reasoning_content?: string
  citations?: string[]
  error?: string
  done?: boolean
}

export abstract class BaseChunkTransformer {
  protected streamController!: ReadableStreamDefaultController
  protected stream: ReadableStream
  protected encoder = new TextEncoder()
  protected decoder = new TextDecoder()
  protected content = ''
  protected thinkingContent = ''
  protected config: OpenAI.ChatConfig
  protected messages: OpenAI.Message[]
  protected callbacks: (() => void)[] = []
  protected abstract parser: EventSourceParser

  constructor (
    req: Response,
    config: OpenAI.ChatConfig,
    messages: OpenAI.Message[]
  ) {
    this.messages = messages
    this.config = config
    this.stream = new ReadableStream({
      start: controller => {
        this.streamController = controller
        this.read(req)
      }
    })
  }

  protected abstract parse(e: EventSourceMessage): void
  protected abstract getChunkType(chunk: unknown): CHUNK_TYPE

  private async read(req: Response) {
    if (!this.streamController) return
    try {
      const contentType = req.headers.get('content-type') || ''
      if (contentType.indexOf('text/event-stream') < 0) {
        const body = await req.text()
        this.send({ error: contentType === 'text/html' ? 'rejected by server' : body })
        this.send({ done: true })
        return
      }

      const reader = req.body!.getReader()
      while (true) {
        const { done, value } = await reader.read()
        const decodedValue = this.decoder.decode(value)
        if (done) {
          this.send({ done: true })
          return
        }
        this.parser.feed(decodedValue)
      }
    } catch (err) {
      console.log(err)
      this.send({ error: err instanceof Error ? err.message : 'unknown error' })
      this.send({ done: true })
    }
  }

  protected send(params: SendParams) {
    this.thinkingContent += params.reasoning_content || ''
    this.content += params.content || ''
    const message: OpenAI.CompletionChunk = {
      id: '',
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
      this.streamController.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
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
      message.choices[0].finish_reason = 'stop'
      this.streamController.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
      this.streamController.enqueue(this.encoder.encode(`data: [DONE]\n\n`))
      this.streamController.close()
      this.callbacks.forEach(cb => cb())
      return
    }

    this.streamController.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
  }

  onDone(cb: () => void) {
    this.callbacks.push(cb)
  }

  getStream() {
    return this.stream
  }
}

export enum CHUNK_TYPE {
  ERROR = 'ERROR',
  START = 'START',
  DEEPSEARCHING = 'DEEPSEARCHING',
  SEARCHING = 'SEARCHING',
  SEARCHING_DONE = 'SEARCHING_DONE',
  THINKING = 'THINKING',
  TEXT = 'TEXT',
  SUGGESTION = 'SUGGESTION',
  DONE = 'DONE',
  NONE = 'NONE'
}

export { createParser }
export type { EventSourceParser }
