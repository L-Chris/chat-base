import { Hono } from 'hono'
import type { BaseChatService } from './chat-service.ts'
import type { OpenAI } from './types.ts'

export interface HttpAdapterOptions {
  createService: (req: Request) => BaseChatService
  getModels: () => OpenAI.Model[]
}

export function createOpenAICompatibleApp(options: HttpAdapterOptions) {
  const app = new Hono()

  app.get('/v1/models', (c: any) => {
    const models = options.getModels().map(m => ({
      object: 'model',
      created: Math.trunc(Date.now() / 1000),
      owned_by: 'chat-base',
      ...m
    }))
    return c.json({ object: 'list', data: models })
  })

  app.post('/v1/chat/completions', async (c: any) => {
    const service = options.createService(c.req.raw)
    return await service.handleRequest(c.req.raw)
  })

  return app
}
