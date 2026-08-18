export type SessionStatus =
  | "creating"
  | "ready"
  | "running"
  | "waiting_for_user"
  | "reconnecting"
  | "failed"
  | "expired"
  | "closed";

export type LiveViewMode = "readonly" | "readwrite";

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
}

export interface SessionPolicy {
  allowEvaluate?: boolean;
  allowDownloads?: boolean;
  allowUploads?: boolean;
  allowNetworkInterception?: boolean;
  allowRawCdp?: boolean;
  allowPrivateNetwork?: boolean;
  allowedOrigins?: string[];
  blockedOrigins?: string[];
  maxActionMs?: number;
  maxPages?: number;
}

export interface CreateSessionOptions {
  tenantId?: string;
  agentId?: string;
  taskId?: string;
  labels?: Record<string, string>;
  viewport?: Viewport;
  locale?: string;
  timezoneId?: string;
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  userAgent?: string;
  profile?: "ephemeral" | "persistent";
  profileId?: string;
  ttlSeconds?: number;
  idleTimeoutSeconds?: number;
  policy?: SessionPolicy;
}

export interface SessionSummary {
  id: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
  currentUrl?: string;
  title?: string;
  tenantId?: string;
  agentId?: string;
  taskId?: string;
  labels: Record<string, string>;
}

export interface SessionConnection {
  sessionId: string;
  controlUrl: string;
  cdpUrl?: string;
  expiresAt: string;
}

export interface LiveViewToken {
  sessionId: string;
  mode: LiveViewMode;
  url: string;
  expiresAt: string;
}

export interface ToolCallOptions {
  timeoutMs?: number;
  dryRun?: boolean;
  requireConfirmation?: boolean;
  observationId?: string;
  signal?: AbortSignal;
}

export interface ActionEnvelope {
  actionId: string;
  sessionId: string;
  type: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface ActionTimings {
  admissionMs: number;
  browserMs: number;
  totalMs: number;
}

export interface ToolSuccess<T> {
  ok: true;
  data: T;
  sessionId: string;
  actionId: string;
  durationMs: number;
  timings?: ActionTimings;
}

export interface ToolFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
  sessionId: string;
  actionId: string;
  durationMs: number;
  timings?: ActionTimings;
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export interface BrowserCommandBatchResult {
  ok: boolean;
  batchId: string;
  sessionId: string;
  results: ToolResult<unknown>[];
  completed: number;
  failed: number;
  durationMs: number;
}

export interface PageSnapshot {
  observationId: string;
  url: string;
  title: string;
  text: string;
  elements: InteractiveElement[];
  capturedAt: string;
}

export interface InteractiveElement {
  ref: string;
  role?: string;
  name?: string;
  tagName: string;
  text?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  disabled: boolean;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserCommand =
  | { type: "navigate"; url: string }
  | { type: "reload" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "observe" }
  | { type: "click"; ref?: string; selector?: string; x?: number; y?: number; button?: "left" | "middle" | "right"; clickCount?: number }
  | { type: "fill"; ref?: string; selector?: string; value: string }
  | { type: "type"; ref?: string; selector?: string; text: string; delayMs?: number }
  | { type: "press"; key: string }
  | { type: "scroll"; x?: number; y?: number; deltaX?: number; deltaY?: number }
  | { type: "hover"; ref?: string; selector?: string; x?: number; y?: number }
  | { type: "screenshot"; fullPage?: boolean; format?: "png" | "jpeg" | "webp"; quality?: number; scale?: "css" | "device"; clip?: { x: number; y: number; width: number; height: number }; adaptive?: boolean }
  | { type: "pdf"; adaptive?: boolean; landscape?: boolean; preferCSSPageSize?: boolean }
  | { type: "wait"; ms?: number; selector?: string; url?: string }
  | { type: "evaluate"; expression: string }
  | { type: "close" };

export interface BrowserEvent {
  sequence: number;
  sessionId: string;
  type:
    | "session.ready"
    | "session.closed"
    | "session.reconnecting"
    | "action.started"
    | "action.completed"
    | "action.failed"
    | "page.changed"
    | "console.message"
    | "user.takeover.requested"
    | "user.takeover.started"
    | "user.takeover.ended"
    | "error";
  at: string;
  data?: Record<string, unknown>;
}

export interface BrowserKitOptions {
  baseUrl: string;
  apiKey?: string;
  tenantId?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}

export interface BrowserKitRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
