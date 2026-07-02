import { Hono } from "@hono/hono";
import type {
  ChatCompletionRequest,
  ChatMessage,
  ListModelsResponse,
} from "../openai/types.ts";
import { apiErrorBody, invalidRequestError, toApiError } from "./errors.ts";
import type { ChatProvider, RequestContext } from "./provider.ts";
import { sseResponse } from "../stream/sse.ts";

export interface ChatApiServerOptions<TAuth> {
  provider: ChatProvider<TAuth>;
  root?: unknown | (() => unknown);
  enableCors?: boolean;
  chatPath?: string;
  modelsPath?: string;
  routes?: ChatApiRoute[];
}

export interface ChatApiRoute {
  provider: ChatProvider<any>;
  chatPath?: string;
  modelsPath?: string;
}

export class ChatApiServer<TAuth = unknown> {
  readonly app: Hono = new Hono();

  constructor(private readonly options: ChatApiServerOptions<TAuth>) {
    this.configure();
  }

  fetch = (request: Request): Response | Promise<Response> =>
    this.app.fetch(request);

  listen(
    options: { port?: number; hostname?: string } = {},
  ): Deno.HttpServer<Deno.NetAddr> {
    const port = options.port ?? Number(Deno.env.get("PORT") ?? "8000");
    const hostname = options.hostname ?? "0.0.0.0";
    return Deno.serve({ hostname, port }, this.fetch);
  }

  private configure(): void {
    if (this.options.enableCors) this.installCors();

    this.app.onError((error, c) => {
      console.error(error);
      const apiError = toApiError(error);
      return c.json(apiError.toBody(), apiError.status as never);
    });

    this.app.get("/", (c) => {
      const root = typeof this.options.root === "function"
        ? this.options.root()
        : this.options.root ?? "Hello World";
      return typeof root === "string" ? c.text(root) : c.json(root);
    });

    this.installProviderRoutes({
      provider: this.options.provider as ChatProvider<any>,
      chatPath: this.options.chatPath,
      modelsPath: this.options.modelsPath,
    });

    for (const route of this.options.routes ?? []) {
      this.installProviderRoutes(route);
    }
  }

  private installProviderRoutes(route: ChatApiRoute): void {
    this.app.post(
      route.chatPath ?? "/v1/chat/completions",
      async (c) => {
        const body = await c.req.json() as ChatCompletionRequest;
        const messages = body?.messages as ChatMessage[] | undefined;
        if (!Array.isArray(messages) || messages.length === 0) {
          throw invalidRequestError(
            "messages is required and must be a non-empty array",
            "invalid_messages",
          );
        }

        const context = await this.createRequestContext(c.req.raw, route);
        const config = route.provider.buildConfig(body);
        const input = { body, messages, config, context };

        if (config.stream) {
          const stream = await route.provider.createChatCompletionStream(input);
          return sseResponse(stream);
        }

        const response = await route.provider.createChatCompletion(input);
        return c.json(response);
      },
    );

    this.app.get(route.modelsPath ?? "/v1/models", async (c) => {
      const context = await this.createRequestContext(c.req.raw, route);
      const models = await route.provider.listModels(context);
      return c.json(normalizeModels(models));
    });
  }

  private async createRequestContext(
    request: Request,
    route: ChatApiRoute = {
      provider: this.options.provider as ChatProvider<any>,
    },
  ): Promise<RequestContext<unknown>> {
    const auth = await route.provider.authenticate(request.headers);
    return { auth, headers: request.headers, rawRequest: request };
  }

  private installCors(): void {
    this.app.use("*", async (c, next) => {
      if (c.req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      await next();
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    });
  }

  errorResponse(error: unknown): Response {
    const apiError = toApiError(error);
    return Response.json(apiErrorBody(apiError), { status: apiError.status });
  }
}

function normalizeModels(models: ListModelsResponse): ListModelsResponse {
  return {
    object: models.object ?? "list",
    data: models.data,
  };
}
