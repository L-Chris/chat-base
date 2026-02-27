export declare namespace OpenAI {
  interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool'
    type?: 'text' | 'image' | 'file'
    image?: string
    content: string | MessageContent[]
    tool_calls?: ToolCall[]
    tool_call_id?: string
  }

  interface MessageContent {
    type: 'text' | 'file' | 'image_url' | 'image'
    file_url?: {
      url: string
    }
    image_url?: {
      url: string
    }
    text?: string
  }

  interface CompletionChunk {
    id: string
    model: string
    object: string
    citations: string[]
    created: number
    choices: {
      index: number
      message?: {
        role: 'assistant' | 'user'
        content: string
        reasoning_content?: string
        tool_calls?: ToolCall[]
      }
      delta?: {
        role?: 'assistant' | 'user'
        content?: string
        reasoning_content?: string
        tool_calls?: ToolCall[]
      }
      finish_reason: null | 'stop' | 'tool_calls'
    }[]
    usage?: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
    error?: {
      message: string
      type: string
    }
  }

  interface Tool {
    type: 'function'
    function: {
      name: string
      description: string
      parameters: {
        type: 'object'
        properties: Record<
          string,
          {
            type: string
            description: string
          }
        >
        required: string[]
        additionalProperties: boolean
      }
      strict: boolean
    }
  }

  interface ToolCall {
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }

  type ToolChoice = 'auto' | 'required'

  interface ChatConfig {
    chat_id: string
    chat_type: 't2t' | 't2v' | 't2i' | 'search' | 'artifacts'
    model_name: string
    response_format: {
      type: 'text' | 'json_schema' | 'json_object'
      json_schema?: Record<string, any>
    }
    features: {
      thinking: boolean
      searching: boolean
    }
    stream: boolean
    tools: Tool[]
    tool_choice: ToolChoice
    is_tool_calling: boolean
    is_tool_calling_done: boolean
  }

  interface Model {
    id: string
    name: string
    description: string
  }

  enum CHUNK_TYPE {
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

  interface SendParams {
    content?: string
    reasoning_content?: string
    citations?: string[]
    finish_reason?: 'stop' | 'tool_calls'
    error?: string
    done?: boolean
  }

  interface UpstreamRequest {
    url: string
    init: RequestInit
  }

  interface UploadInput {
    filename: string
    mimeType: string
    data: Uint8Array
  }

  interface UploadResult {
    id: string
    url: string
    filename: string
    mimeType: string
    size: number
    metadata?: Record<string, unknown>
  }
}
