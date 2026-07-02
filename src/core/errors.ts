export interface ApiErrorBody {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code?: string;

  constructor(
    message: string,
    options: { status?: number; type?: string; code?: string } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 500;
    this.type = options.type ?? "api_error";
    this.code = options.code;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
      },
    };
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    return new ApiError(error.message, {
      status: 500,
      type: "server_error",
      code: "internal_server_error",
    });
  }
  return new ApiError(String(error), {
    status: 500,
    type: "server_error",
    code: "internal_server_error",
  });
}

export function apiErrorBody(error: unknown): ApiErrorBody {
  return toApiError(error).toBody();
}

export function missingAuthError(message = "need token"): ApiError {
  return new ApiError(message, {
    status: 401,
    type: "authentication_error",
    code: "missing_authentication",
  });
}

export function invalidRequestError(
  message: string,
  code = "invalid_request",
): ApiError {
  return new ApiError(message, {
    status: 400,
    type: "invalid_request_error",
    code,
  });
}
