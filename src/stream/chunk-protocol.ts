export enum CHUNK_TYPE {
  ERROR = "ERROR",
  START = "START",
  THINKING_START = "THINKING_START",
  THINKING_END = "THINKING_END",
  DEEPSEARCHING = "DEEPSEARCHING",
  SEARCHING = "SEARCHING",
  SEARCHING_DONE = "SEARCHING_DONE",
  THINKING = "THINKING",
  TEXT = "TEXT",
  TOOL_CALL = "TOOL_CALL",
  SUGGESTION = "SUGGESTION",
  DONE = "DONE",
  NONE = "NONE",
}

export type ChunkType = `${CHUNK_TYPE}`;

export interface ChunkProtocol<TChunk, TEvent = unknown> {
  getChunkType(chunk: TChunk, event: TEvent): CHUNK_TYPE;
}
