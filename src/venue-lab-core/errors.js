export class SocialError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "SocialError";
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details = undefined) {
  throw new SocialError(code, message, details);
}

export function asErrorPayload(error) {
  if (error instanceof SocialError) {
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
      message: "The social service could not complete the request.",
    },
  };
}
