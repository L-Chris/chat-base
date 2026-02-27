import type { OpenAI } from './types.ts'
import { uuid } from './utils.ts'

export interface UploadContext {
  credentials: Record<string, string>
  signal?: AbortSignal
}

export interface Uploader {
  upload: (input: OpenAI.UploadInput, ctx: UploadContext) => Promise<OpenAI.UploadResult>
}

export class DefaultUploader implements Uploader {
  async upload(input: OpenAI.UploadInput, _ctx: UploadContext): Promise<OpenAI.UploadResult> {
    const id = uuid()
    return {
      id,
      url: `upload://${id}`,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.data.byteLength,
      metadata: {
        provider: 'default'
      }
    }
  }
}

export async function fetchUploadInputFromUrl(url: string, filename = 'file.bin'): Promise<OpenAI.UploadInput> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to fetch upload url: ${res.status}`)
  const arr = new Uint8Array(await res.arrayBuffer())
  const mimeType = res.headers.get('content-type') || 'application/octet-stream'
  return {
    filename,
    mimeType,
    data: arr
  }
}
