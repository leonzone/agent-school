export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorBody(error: unknown): { error: { code: string; message: string; details?: unknown } } {
  if (error instanceof HttpError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "本地服务发生未预期错误",
    },
  };
}
