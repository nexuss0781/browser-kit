import { BrowserKitError, errorCodes } from "./errors.js";
import { createBrowserTools, type BrowserToolDefinition } from "./tools.js";
import type {
  BrowserCommand,
  BrowserEvent,
  BrowserKitOptions,
  BrowserKitRequestOptions,
  CreateSessionOptions,
  LiveViewMode,
  LiveViewToken,
  PageSnapshot,
  SessionConnection,
  SessionSummary,
  ToolCallOptions,
  ToolResult,
} from "./types.js";

export class BrowserKit {
  readonly sessions: SessionClient;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: BrowserKitOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.sessions = new SessionClient(this);
  }

  async createSession(options: CreateSessionOptions = {}): Promise<BrowserSession> {
    return this.sessions.create(options);
  }

  async connect(sessionId: string): Promise<ConnectedBrowser> {
    const connection = await this.request<SessionConnection>(`/v1/sessions/${sessionId}/connect`, { method: "POST" });
    return new ConnectedBrowser(this, sessionId, connection);
  }

  async request<T>(path: string, init: RequestInit = {}, requestOptions: BrowserKitRequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestOptions.timeoutMs ?? this.timeoutMs);
    if (requestOptions.signal) {
      if (requestOptions.signal.aborted) controller.abort(requestOptions.signal.reason);
      else requestOptions.signal.addEventListener("abort", () => controller.abort(requestOptions.signal?.reason), { once: true });
    }
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (this.options.apiKey) headers.set("authorization", `Bearer ${this.options.apiKey}`);
    if (this.options.tenantId) headers.set("x-tenant-id", this.options.tenantId);

    try {
      const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const body = await response.text();
      const parsed = body ? this.parseJson(body) : undefined;
      if (!response.ok) {
        const errorBody = typeof parsed === "object" && parsed !== null && "error" in parsed ? parsed.error : undefined;
        const error = typeof errorBody === "object" && errorBody !== null ? errorBody as Record<string, unknown> : {};
        throw new BrowserKitError(
          typeof error.code === "string" ? error.code : errorCodes.internal,
          typeof error.message === "string" ? error.message : `Browser Kit request failed with ${response.status}`,
          { status: response.status, retryable: response.status >= 500 || response.status === 429, details: error },
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof BrowserKitError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new BrowserKitError(errorCodes.actionTimeout, "Browser Kit request timed out", { retryable: true, status: 504, cause: error });
      }
      throw new BrowserKitError(errorCodes.browserDisconnected, "Browser Kit request failed", { retryable: true, cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  async createTools(sessionId: string): Promise<BrowserToolDefinition[]> {
    const session = await this.connect(sessionId);
    return createBrowserTools((command, options) => session.execute(command, options));
  }

  private parseJson(body: string): unknown {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
}

export class SessionClient {
  constructor(private readonly kit: BrowserKit) {}

  async create(options: CreateSessionOptions = {}): Promise<BrowserSession> {
    const summary = await this.kit.request<SessionSummary>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify(options),
    });
    return new BrowserSession(this.kit, summary);
  }

  async list(): Promise<SessionSummary[]> {
    const response = await this.kit.request<{ data: SessionSummary[] }>("/v1/sessions");
    return response.data;
  }

  async get(id: string): Promise<BrowserSession> {
    const summary = await this.kit.request<SessionSummary>(`/v1/sessions/${encodeURIComponent(id)}`);
    return new BrowserSession(this.kit, summary);
  }
}

export class BrowserSession {
  readonly page: Page;
  private connectedBrowser: ConnectedBrowser | undefined;

  constructor(protected readonly kit: BrowserKit, readonly summary: SessionSummary) {
    this.page = new Page(this, undefined, undefined);
  }

  get id(): string {
    return this.summary.id;
  }

  async connect(): Promise<ConnectedBrowser> {
    this.connectedBrowser ??= await this.kit.connect(this.id);
    return this.connectedBrowser;
  }

  async execute(command: BrowserCommand, options: ToolCallOptions = {}): Promise<ToolResult<unknown>> {
    return this.kit.request<ToolResult<unknown>>(`/v1/sessions/${encodeURIComponent(this.id)}/commands`, {
      method: "POST",
      body: JSON.stringify({ command }),
    }, options);
  }

  async liveView(mode: LiveViewMode = "readonly"): Promise<LiveViewToken> {
    return this.kit.request<LiveViewToken>(`/v1/sessions/${encodeURIComponent(this.id)}/live-view`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  }

  async close(): Promise<void> {
    await this.kit.request(`/v1/sessions/${encodeURIComponent(this.id)}/close`, { method: "POST" });
  }

  async events(options: { onEvent: (event: BrowserEvent) => void; signal?: AbortSignal } ): Promise<ControlConnection> {
    const connected = await this.connect();
    return connected.events(options);
  }
}

export class ConnectedBrowser extends BrowserSession {
  readonly connection: SessionConnection;
  private control: ControlConnection | undefined;

  constructor(kit: BrowserKit, sessionId: string, connection: SessionConnection) {
    super(kit, {
      id: sessionId,
      status: "running",
      createdAt: new Date().toISOString(),
      expiresAt: connection.expiresAt,
      lastActivityAt: new Date().toISOString(),
      labels: {},
    });
    this.connection = connection;
  }

  override async connect(): Promise<ConnectedBrowser> {
    return this;
  }

  override async events(options: { onEvent: (event: BrowserEvent) => void; signal?: AbortSignal } = { onEvent: () => undefined }): Promise<ControlConnection> {
    this.control ??= new ControlConnection(this.connection.controlUrl, options);
    this.control.start();
    return this.control;
  }
}

export class Page {
  readonly keyboard: Keyboard;

  constructor(private readonly session: BrowserSession, private readonly ref: string | undefined, private readonly selector: string | undefined) {
    this.keyboard = new Keyboard(session);
  }

  locator(selector: string): Locator {
    return new Locator(this.session, undefined, selector);
  }

  getByRef(ref: string): Locator {
    return new Locator(this.session, ref, undefined);
  }

  async goto(url: string, options?: ToolCallOptions): Promise<ToolResult<unknown>> {
    return this.session.execute({ type: "navigate", url }, options);
  }

  async observe(options?: ToolCallOptions): Promise<ToolResult<unknown>> {
    return this.session.execute({ type: "observe" }, options);
  }

  async screenshot(options: { fullPage?: boolean; format?: "png" | "jpeg" | "webp" } & ToolCallOptions = {}): Promise<ToolResult<unknown>> {
    const { signal, timeoutMs, dryRun, requireConfirmation, observationId, fullPage, format } = options;
    const toolOptions: ToolCallOptions = {};
    if (signal) toolOptions.signal = signal;
    if (timeoutMs !== undefined) toolOptions.timeoutMs = timeoutMs;
    if (dryRun !== undefined) toolOptions.dryRun = dryRun;
    if (requireConfirmation !== undefined) toolOptions.requireConfirmation = requireConfirmation;
    if (observationId) toolOptions.observationId = observationId;
    return this.session.execute({ type: "screenshot", ...(fullPage === undefined ? {} : { fullPage }), ...(format === undefined ? {} : { format }) }, toolOptions);
  }

  async pdf(options?: ToolCallOptions): Promise<ToolResult<unknown>> {
    return this.session.execute({ type: "pdf" }, options);
  }

  async evaluate(expression: string, options?: ToolCallOptions): Promise<ToolResult<unknown>> {
    return this.session.execute({ type: "evaluate", expression }, options);
  }
}

export class Locator {
  constructor(private readonly session: BrowserSession, private readonly ref: string | undefined, private readonly selector: string | undefined) {}

  async click(options?: ToolCallOptions): Promise<ToolResult<unknown>> {
    return this.session.execute({ type: "click", ...(this.ref ? { ref: this.ref } : {}), ...(this.selector ? { selector: this.selector } : {}) }, options);
  }

  async fill(value: string, options?: ToolCallOptions): Promise<ToolResult<unknown>> {
    return this.session.execute({ type: "fill", value, ...(this.ref ? { ref: this.ref } : {}), ...(this.selector ? { selector: this.selector } : {}) }, options);
  }

  async type(text: string, options: ToolCallOptions & { delayMs?: number } = {}): Promise<ToolResult<unknown>> {
    const { delayMs, signal, timeoutMs, dryRun, requireConfirmation, observationId } = options;
    const toolOptions: ToolCallOptions = {};
    if (signal) toolOptions.signal = signal;
    if (timeoutMs !== undefined) toolOptions.timeoutMs = timeoutMs;
    if (dryRun !== undefined) toolOptions.dryRun = dryRun;
    if (requireConfirmation !== undefined) toolOptions.requireConfirmation = requireConfirmation;
    if (observationId) toolOptions.observationId = observationId;
    return this.session.execute({ type: "type", text, ...(delayMs === undefined ? {} : { delayMs }), ...(this.ref ? { ref: this.ref } : {}), ...(this.selector ? { selector: this.selector } : {}) }, toolOptions);
  }

  async hover(options?: ToolCallOptions): Promise<ToolResult<unknown>> {
    return this.session.execute({ type: "hover", ...(this.ref ? { ref: this.ref } : {}), ...(this.selector ? { selector: this.selector } : {}) }, options);
  }
}

export class Keyboard {
  constructor(private readonly session: BrowserSession) {}

  press(key: string, options?: ToolCallOptions): Promise<ToolResult<unknown>> {
    return this.session.execute({ type: "press", key }, options);
  }
}

export class ControlConnection {
  private socket: WebSocket | undefined;
  private reconnectAttempts = 0;
  private closed = false;

  constructor(private readonly url: string, private readonly options: { onEvent: (event: BrowserEvent) => void; signal?: AbortSignal; maxReconnectAttempts?: number }) {
    options.signal?.addEventListener("abort", () => this.close(), { once: true });
  }

  start(): void {
    if (this.closed || this.socket) return;
    if (typeof WebSocket === "undefined") throw new BrowserKitError(errorCodes.browserDisconnected, "WebSocket is unavailable in this runtime; use HTTP commands instead");
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => { this.reconnectAttempts = 0; };
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data)) as BrowserEvent;
        if (typeof payload.type === "string") this.options.onEvent(payload);
      } catch {
        // Ignore malformed event frames so one bad message cannot kill the connection.
      }
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      this.socket = undefined;
      if (!this.closed && this.reconnectAttempts < (this.options.maxReconnectAttempts ?? 6)) {
        const delay = Math.min(1_000 * 2 ** this.reconnectAttempts, 8_000);
        this.reconnectAttempts += 1;
        setTimeout(() => this.start(), delay);
      }
    };
  }

  send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new BrowserKitError(errorCodes.browserDisconnected, "Control WebSocket is not connected", { retryable: true });
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = undefined;
  }
}
