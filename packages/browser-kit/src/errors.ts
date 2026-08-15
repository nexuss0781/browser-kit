export class BrowserKitError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "BrowserKitError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.details = options.details;
  }
}

export const errorCodes = {
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  notFound: "NOT_FOUND",
  invalidRequest: "INVALID_REQUEST",
  sessionLimit: "SESSION_LIMIT",
  sessionExpired: "SESSION_EXPIRED",
  staleObservation: "STALE_OBSERVATION",
  elementNotFound: "ELEMENT_NOT_FOUND",
  elementNotActionable: "ELEMENT_NOT_ACTIONABLE",
  navigationTimeout: "NAVIGATION_TIMEOUT",
  actionTimeout: "ACTION_TIMEOUT",
  browserUnavailable: "BROWSER_UNAVAILABLE",
  browserDisconnected: "BROWSER_DISCONNECTED",
  policyDenied: "POLICY_DENIED",
  internal: "INTERNAL_ERROR",
} as const;

export type BrowserKitErrorCode = (typeof errorCodes)[keyof typeof errorCodes];
