import type { OpenAI } from "./types.ts";
import { buildChatConfig, resolveModelFeaturesByName } from './config.ts'

export const getChatConfig = (body: {
  stream?: boolean
  chat_id?: string
  response_format?: OpenAI.ChatConfig['response_format']
  model: string
  tools?: OpenAI.Tool[]
  tool_choice?: OpenAI.ToolChoice
  messages: OpenAI.Message[]
}): OpenAI.ChatConfig => {
  return buildChatConfig({
    ...body,
    defaultStream: false,
    modelFeatureResolver: model => {
      const features = resolveModelFeaturesByName(model)
      return features
    }
  })
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