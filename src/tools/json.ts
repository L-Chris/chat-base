import { jsonrepair } from "jsonrepair";

export function safeJsonParse<T = unknown>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function extractJsonFromContent<T = unknown>(value: string): T | null {
  const raw = extractJsonCandidate(value);
  if (!raw) return null;

  try {
    return JSON.parse(jsonrepair(raw)) as T;
  } catch {
    return null;
  }
}

export function extractJsonCandidate(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}
