import { crypto } from 'https://deno.land/std/crypto/mod.ts'

export const uuid = () => crypto.randomUUID()

export function extractJsonFromContent (data: string) {
  try {
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = data.match(jsonRegex);
    
    if (!match || !match[1]) return JSON.parse(data);
    
    const jsonString = match[1].trim();
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('解析JSON失败:', error);
    return null;
  }
}

export const dataUtil = {
  isBASE64Data (value: string) {
    return _.isString(value) && /^data:/.test(value)
  },
  extractBASE64DataFormat (value: string) {
    const match = value.trim().match(/^data:(.+);base64,/)
    if (!match) return null
    return match[1]
  },
  removeBASE64DataHeader (value: string): string {
    return value.replace(/^data:(.+);base64,/, '')
  },
  base64ToUint8Array (string: string) {
    return Uint8Array.from(atob(string), c => c.charCodeAt(0))
  },
  isImageMime (_: string) {
    return [
      'image/jpeg',
      'image/jpg',
      'image/tiff',
      'image/png',
      'image/bmp',
      'image/gif',
      'image/svg+xml',
      'image/webp',
      'image/ico',
      'image/heic',
      'image/heif',
      'image/bmp',
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/x-png'
    ].includes(_)
  }
}