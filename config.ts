import type { OpenAI } from './types.ts'

export type ModelFeatureResolver = (model: string) => {
  thinking: boolean
  searching: boolean
}

export function resolveModelFeaturesByName(model: string): {
  thinking: boolean
  searching: boolean
} {
  const parts = (model || '').split('_')
  const thinking = parts.includes('deepsearch') || parts.includes('think')
  const searching = parts.includes('deepsearch') || parts.includes('search')
  return { thinking, searching }
}

export function buildChatConfig(body: {
  stream?: boolean
  chat_id?: string
  response_format?: OpenAI.ChatConfig['response_format']
  model: string
  tools?: OpenAI.Tool[]
  tool_choice?: OpenAI.ToolChoice
  messages: OpenAI.Message[]
  modelFeatureResolver?: ModelFeatureResolver
  defaultStream?: boolean
}): OpenAI.ChatConfig {
  const response_format: OpenAI.ChatConfig['response_format'] = body.response_format?.type
    ? body.response_format
    : { type: 'text' }
  const stream = typeof body.stream === 'boolean' ? body.stream : (body.defaultStream ?? true)
  const tools: OpenAI.Tool[] = body.tools || []
  const is_tool_calling = tools.length > 0 && !body.messages.some(m => m.role === 'tool')
  const is_tool_calling_done = tools.length > 0 && body.messages.some(m => m.role === 'tool')
  const resolver = body.modelFeatureResolver || resolveModelFeaturesByName
  const features = resolver(body.model)

  return {
    model_name: body.model,
    features,
    response_format,
    chat_id: body.chat_id || '',
    chat_type: features.searching ? 'search' : 't2t',
    stream,
    tools,
    tool_choice: body.tool_choice || 'auto',
    is_tool_calling,
    is_tool_calling_done
  }
}
