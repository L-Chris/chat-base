import { BaseChatService, type EventSourceMessage } from './chat-service.ts'
import { OpenAI } from './types.ts'
import type { ProviderAdapter } from './provider-contracts.ts'

export class AdapterChatService extends BaseChatService {
  constructor(private readonly adapter: ProviderAdapter) {
    super()
  }

  protected async createCompletion(): Promise<void> {
    const upstream = await this.adapter.buildUpstreamRequest({
      req: this.req,
      credentials: this.credentials,
      config: this.getUpstreamChatConfig(),
      messages: this.messages
    })

    const res = await fetch(upstream.url, upstream.init)
    await this.readUpstream(res)
  }

  protected getModels(): OpenAI.Model[] {
    return this.adapter.getModels()
  }

  protected generateHeaders(): Record<string, string> {
    return {}
  }

  protected parse(e: EventSourceMessage): void {
    const parsed = this.adapter.parseEvent(e, {
      config: this.config,
      messages: this.messages
    })

    if (!parsed) return

    const chunks = Array.isArray(parsed) ? parsed : [parsed]
    for (const chunk of chunks) {
      this.send(chunk)
    }

    const hasDone = chunks.some(chunk => chunk.done)
    if (hasDone && this.adapter.onAfterDone) {
      Promise.resolve(this.adapter.onAfterDone({
        config: this.config,
        messages: this.messages
      })).catch(err => {
        this.send({ error: err instanceof Error ? err.message : 'after done error' })
      })
    }
  }

  protected getChunkType(_chunk: unknown): OpenAI.CHUNK_TYPE {
    return OpenAI.CHUNK_TYPE.NONE
  }

  protected getModelFeatures(model: string): { thinking: boolean; searching: boolean } {
    return this.adapter.getModelFeatures(model)
  }
}
