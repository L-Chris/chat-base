import type { EventSourceMessage } from './chat-service.ts'
import type { OpenAI } from './types.ts'

export interface ProviderRequestContext {
  req: Request
  credentials: Record<string, string>
  config: OpenAI.ChatConfig
  messages: OpenAI.Message[]
}

export interface ProviderParseContext {
  config: OpenAI.ChatConfig
  messages: OpenAI.Message[]
}

export interface ProviderAdapter {
  name: string
  getModels: () => OpenAI.Model[]
  getModelFeatures: (model: string) => { thinking: boolean, searching: boolean }
  buildUpstreamRequest: (ctx: ProviderRequestContext) => Promise<OpenAI.UpstreamRequest>
  parseEvent: (event: EventSourceMessage, ctx: ProviderParseContext) => OpenAI.SendParams | OpenAI.SendParams[] | null
  onAfterDone?: (ctx: ProviderParseContext) => Promise<void> | void
}
