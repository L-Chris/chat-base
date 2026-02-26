import { Hono } from "hono";
import type { OpenAI } from "./types.ts";

const app = new Hono();

app.get("/", (c) => c.text("Hello World"));

export abstract class BaseChatService {
  protected app = app;

  constructor() {
    this.app = app;
  }

  protected abstract createConversation(): Promise<void>;

  protected abstract removeConversation(): Promise<void>;

  protected abstract createCompletionStream(): Promise<void>;

  protected abstract createCompletion(): Promise<void>;

  protected abstract getModels(): OpenAI.Model[];

  protected abstract generateHeaders(): Record<string, string>;

  protected parseAuthHeader(authHeader: string): Record<string, string> {
    const authContent = authHeader.replace(/^Bearer /, "");

    const authMap: Record<string, string> = {};

    const parts = authContent.split(/\s+/);

    if (parts.length === 0) return authMap;
    if (parts.length === 1) {
      authMap.token = parts[0];
      return authMap;
    }

    parts.forEach((part) => {
      const [key, value] = part.split(":");
      if (key && value) authMap[key] = value;
    });

    return authMap;
  }
}

export default app;
