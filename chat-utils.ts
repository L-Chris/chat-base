import type { OpenAI } from "./types.ts";

export const getChatConfig = (body: {
  stream?: boolean
  chat_id?: string
  response_format?: OpenAI.ChatConfig['response_format']
  model: string
  tools?: OpenAI.Tool[]
  tool_choice?: OpenAI.ToolChoice
  messages: OpenAI.Message[]
}): OpenAI.ChatConfig => {
  const parts = (body.model || 'longcat').split('_')
  const response_format: OpenAI.ChatConfig['response_format'] = body.response_format?.type ? body.response_format : { type: 'text' }
  const stream = typeof body.stream === 'boolean' ? body.stream : false
  const tools: OpenAI.Tool[] = body.tools || []
  const is_tool_calling = tools.length > 0 && !body.messages.some(m => m.role === 'tool')
  const is_tool_calling_done = tools.length > 0 && body.messages.some(m => m.role === 'tool')
  return {  
    model_name: parts[0],
    features: {
      thinking: parts.includes('deepsearch') || parts.includes('think'),
      searching: parts.includes('deepsearch') || parts.includes('search')
    },
    response_format: response_format,
    chat_id: body.chat_id || '',
    chat_type: (parts.includes('deepsearch') || parts.includes('search')) ? 'search' : 't2t',
    stream,
    tools: tools,
    tool_choice: body.tool_choice || 'auto',
    is_tool_calling,
    is_tool_calling_done
  }
}

export function extractFileUrlsFromMessages (data: OpenAI.Message[]): string[] {
  const res: string[] = []

  if (!data.length) return res

  const lastMessage = data[data.length - 1]

  if (Array.isArray(lastMessage.content)) {
    lastMessage.content.forEach(v => {
      if (!(typeof v === 'object' && v !== null) || !['file', 'image_url'].includes(v.type)) return
      if (v['type'] == 'file' && typeof v.file_url?.url === 'string') {
        res.push(v.file_url?.url!)
      } else if (v['type'] == 'image_url' && typeof v.image_url?.url === 'string') {
        // 兼容gpt-4-vision-preview API格式
        res.push(v.image_url?.url!)
      }
    })
  }

  return res
}