import { BaseChatService, type EventSourceMessage } from "./chat-service.ts";
import { AdapterChatService } from "./adapter-chat-service.ts";
import { OpenAI } from "./types.ts";
import {
  dataUtil,
  extractJsonFromContent,
  parseCredentials,
  safeJSONParse,
  uuid,
} from "./utils.ts";
import { extractFileUrlsFromMessages } from "./chat-utils.ts";
import { buildChatConfig, resolveModelFeaturesByName } from "./config.ts";
import { createOpenAICompatibleApp } from "./http-adapter.ts";
import type {
  ProviderAdapter,
  ProviderParseContext,
  ProviderRequestContext,
} from "./provider-contracts.ts";
import { DefaultUploader, fetchUploadInputFromUrl } from "./upload.ts";
import type { UploadContext, Uploader } from "./upload.ts";

export {
  AdapterChatService,
  BaseChatService,
  buildChatConfig,
  createOpenAICompatibleApp,
  dataUtil,
  DefaultUploader,
  extractFileUrlsFromMessages,
  extractJsonFromContent,
  fetchUploadInputFromUrl,
  OpenAI,
  parseCredentials,
  resolveModelFeaturesByName,
  safeJSONParse,
  uuid,
};

export type { EventSourceMessage };
export type {
  ProviderAdapter,
  ProviderParseContext,
  ProviderRequestContext,
  UploadContext,
  Uploader,
};

export * from "./src/core/mod.ts";
export * from "./src/openai/mod.ts";
export * from "./src/stream/mod.ts";
export * from "./src/tools/mod.ts";
export * from "./src/adapters/mod.ts";
