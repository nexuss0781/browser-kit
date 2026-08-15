import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, BrowserContextOptions, LaunchOptions, Page } from "playwright-core";
import { chromium } from "playwright-core";
import type {
  BrowserCommand,
  CreateSessionOptions,
  InteractiveElement,
  PageSnapshot,
  SessionConnection,
  SessionPolicy,
  SessionStatus,
  SessionSummary,
  ToolFailure,
  ToolResult,
  ToolSuccess,
} from "browser-kit";
import { BrowserKitError, errorCodes } from "browser-kit";
import type { ServerConfig } from "./config.js";

interface TabRecord {
  id: string;
  page: Page;
  createdAt: number;
}

type TabSummary = {
  id: string;
  url: string;
  title: string;
  createdAt: string;
};

const DEFAULT_START_URL = "https://www.google.com";

interface SessionRecord {
  id: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
  lastActivityAt: number;
  options: CreateSessionOptions;
  policy: SessionPolicy;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  tabs: Map<string, TabRecord>;
  activeTabId: string;
  eventSequence: number;
  currentObservationId: string | undefined;
  initialFrame: Buffer | undefined;
  initialFramePromise: Promise<Buffer | undefined> | undefined;
  initialNavigationTimer: NodeJS.Timeout | undefined;
  idleTimer: NodeJS.Timeout;
  ttlTimer: NodeJS.Timeout;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private browserPromise: Promise<Browser> | undefined;
  private browserCloseTimer: NodeJS.Timeout | undefined;

  constructor(private readonly config: ServerConfig) {}

  private async browser(): Promise<Browser> {
    if (this.browserCloseTimer) {
      clearTimeout(this.browserCloseTimer);
      this.browserCloseTimer = undefined;
    }
    const launchOptions: LaunchOptions = {
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
    };
    if (this.config.browserExecutablePath) launchOptions.executablePath = this.config.browserExecutablePath;
    this.browserPromise ??= chromium.launch(launchOptions);
    return this.browserPromise;
  }

  async create(options: CreateSessionOptions = {}): Promise<SessionSummary> {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new BrowserKitError(errorCodes.sessionLimit, "Maximum concurrent browser sessions reached", { retryable: true, status: 429 });
    }

    const now = Date.now();
    const ttlSeconds = options.ttlSeconds ?? this.config.defaultTtlSeconds;
    const idleTimeoutSeconds = options.idleTimeoutSeconds ?? this.config.defaultIdleTimeoutSeconds;
    const browser = await this.browser();
    const contextOptions: BrowserContextOptions = {
      viewport: options.viewport
        ? { width: options.viewport.width, height: options.viewport.height }
        : { width: 1440, height: 900 },
      serviceWorkers: "allow",
    };
    if (options.locale) contextOptions.locale = options.locale;
    if (options.timezoneId) contextOptions.timezoneId = options.timezoneId;
    if (options.userAgent) contextOptions.userAgent = options.userAgent;
    if (options.geolocation) {
      contextOptions.geolocation = options.geolocation;
      contextOptions.permissions = ["geolocation"];
    }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>Browser Kit ready</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0b151f;color:#eaf6ff;font:16px system-ui,sans-serif}.card{width:min(520px,calc(100% - 48px));padding:36px;border:1px solid rgba(112,216,255,.25);border-radius:22px;background:linear-gradient(145deg,#102437,#0b151f);box-shadow:0 24px 70px rgba(0,0,0,.3)}.mark{display:grid;place-items:center;width:48px;height:48px;border-radius:15px;background:#70d8ff;color:#06202c;font-weight:900}.eyebrow{margin:24px 0 7px;color:#8de3ff;font:700 11px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}h1{margin:0;font-size:28px;letter-spacing:-.04em}p{margin:12px 0 0;color:#a9c4d8;line-height:1.6}</style></head><body><main class="card"><div class="mark">▣</div><p class="eyebrow">Remote Chrome session</p><h1>Browser Kit is ready</h1><p>Use the console controls to navigate to a website. This session will remain visible in the embedded live panel.</p></main></body></html>`);
    const id = randomUUID();
    const policy: SessionPolicy = {
      allowEvaluate: options.policy?.allowEvaluate ?? this.config.allowEvaluate,
      allowDownloads: options.policy?.allowDownloads ?? false,
      allowUploads: options.policy?.allowUploads ?? false,
      allowNetworkInterception: options.policy?.allowNetworkInterception ?? false,
      allowRawCdp: options.policy?.allowRawCdp ?? false,
      maxActionMs: options.policy?.maxActionMs ?? 30_000,
      maxPages: options.policy?.maxPages ?? 8,
    };
    if (options.policy?.allowedOrigins) policy.allowedOrigins = options.policy.allowedOrigins;
    if (options.policy?.blockedOrigins) policy.blockedOrigins = options.policy.blockedOrigins;
    const record: SessionRecord = {
      id,
      status: "ready",
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
      lastActivityAt: now,
      options,
      policy,
      browser,
      context,
      page,
      tabs: new Map(),
      activeTabId: "",
      eventSequence: 0,
      currentObservationId: undefined,
      initialFrame: undefined,
      initialFramePromise: undefined,
      initialNavigationTimer: undefined,
      idleTimer: setTimeout(() => void this.close(id, "idle_timeout"), idleTimeoutSeconds * 1000),
      ttlTimer: setTimeout(() => void this.close(id, "ttl_expired"), ttlSeconds * 1000),
    };
    this.sessions.set(id, record);
    const initialTab = this.trackTab(record, page);
    record.activeTabId = initialTab.id;
    record.initialFramePromise = page.screenshot({ type: "jpeg", quality: 60 })
      .then((frame) => {
        record.initialFrame = frame;
        return frame;
      })
      .catch(() => undefined);
    // Return a visible local first frame before starting the remote homepage.
    // This avoids making first paint wait for Google’s network and render work.
    record.initialNavigationTimer = setTimeout(() => void this.openPage(page, DEFAULT_START_URL), 500);
    record.initialNavigationTimer.unref();
    return this.summary(record);
  }

  async captureLiveFrame(id: string): Promise<Buffer> {
    const record = this.get(id);
    record.status = "running";
    this.touch(id);
    if (record.initialFrame) {
      const frame = record.initialFrame;
      record.initialFrame = undefined;
      return frame;
    }
    if (record.initialFramePromise) {
      const frame = await record.initialFramePromise;
      record.initialFramePromise = undefined;
      if (frame) return frame;
    }
    return this.withTimeout(record.page.screenshot({ type: "jpeg", quality: 70 }), record.policy.maxActionMs ?? 30_000);
  }

  async listTabs(id: string): Promise<{ activeTabId: string; tabs: TabSummary[] }> {
    const record = this.get(id);
    const tabs = await Promise.all([...record.tabs.values()]
      .filter((tab) => !tab.page.isClosed())
      .map(async (tab): Promise<TabSummary> => {
        const currentUrl = tab.page.url();
        const title = await tab.page.title().catch(() => "");
        return {
          id: tab.id,
          url: currentUrl === "about:blank" ? DEFAULT_START_URL : currentUrl,
          title: title || (currentUrl === "about:blank" ? "Google" : "New tab"),
          createdAt: new Date(tab.createdAt).toISOString(),
        };
      }));
    return { activeTabId: record.activeTabId, tabs };
  }

  async createTab(id: string, url = DEFAULT_START_URL): Promise<{ activeTabId: string; tabs: TabSummary[] }> {
    const record = this.get(id);
    if (record.tabs.size >= (record.policy.maxPages ?? 8)) {
      throw new BrowserKitError(errorCodes.sessionLimit, "Maximum tabs reached for this browser session", { status: 429, retryable: true });
    }
    const tab = this.trackTab(record, await record.context.newPage());
    record.activeTabId = tab.id;
    record.page = tab.page;
    this.touch(id);
    void this.openPage(tab.page, url);
    return this.listTabs(id);
  }

  async activateTab(id: string, tabId: string): Promise<{ activeTabId: string; tabs: TabSummary[] }> {
    const record = this.get(id);
    const tab = record.tabs.get(tabId);
    if (!tab || tab.page.isClosed()) throw new BrowserKitError(errorCodes.notFound, "Browser tab was not found", { status: 404 });
    record.activeTabId = tab.id;
    record.page = tab.page;
    this.touch(id);
    return this.listTabs(id);
  }

  async closeTab(id: string, tabId: string): Promise<{ activeTabId: string; tabs: TabSummary[] }> {
    const record = this.get(id);
    const tab = record.tabs.get(tabId);
    if (!tab || tab.page.isClosed()) throw new BrowserKitError(errorCodes.notFound, "Browser tab was not found", { status: 404 });
    record.tabs.delete(tabId);
    await tab.page.close().catch(() => undefined);
    if (record.tabs.size === 0) {
      const replacement = this.trackTab(record, await record.context.newPage());
      record.activeTabId = replacement.id;
      record.page = replacement.page;
      void this.openPage(replacement.page, DEFAULT_START_URL);
    } else if (record.activeTabId === tabId) {
      const replacement = [...record.tabs.values()].at(-1)!;
      record.activeTabId = replacement.id;
      record.page = replacement.page;
    }
    this.touch(id);
    return this.listTabs(id);
  }

  get(id: string): SessionRecord {
    const record = this.sessions.get(id);
    if (!record) throw new BrowserKitError(errorCodes.notFound, `Session ${id} was not found`, { status: 404 });
    if (record.expiresAt <= Date.now()) {
      void this.close(id, "ttl_expired");
      throw new BrowserKitError(errorCodes.sessionExpired, `Session ${id} has expired`, { status: 410 });
    }
    return record;
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((record) => this.summary(record));
  }

  async connect(id: string, publicUrl: string): Promise<SessionConnection> {
    const record = this.get(id);
    record.status = "running";
    this.touch(id);
    return {
      sessionId: id,
      controlUrl: `${publicUrl.replace(/\/$/, "")}/v1/sessions/${id}/control`,
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  }

  async close(id: string, _reason = "closed"): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) return;
    record.status = "closed";
    clearTimeout(record.idleTimer);
    clearTimeout(record.ttlTimer);
    if (record.initialNavigationTimer) clearTimeout(record.initialNavigationTimer);
    this.sessions.delete(id);
    await record.context.close().catch(() => undefined);
    if (this.sessions.size === 0) this.scheduleBrowserClose();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id, "shutdown")));
    await this.closeBrowserNow();
  }

  private scheduleBrowserClose(): void {
    if (!this.browserPromise) return;
    if (this.browserCloseTimer) clearTimeout(this.browserCloseTimer);
    if (this.config.browserWarmIdleSeconds === 0) {
      void this.closeBrowserNow();
      return;
    }
    this.browserCloseTimer = setTimeout(() => void this.closeBrowserNow(), this.config.browserWarmIdleSeconds * 1000);
    this.browserCloseTimer.unref();
  }

  private async closeBrowserNow(): Promise<void> {
    if (this.browserCloseTimer) clearTimeout(this.browserCloseTimer);
    this.browserCloseTimer = undefined;
    if (!this.browserPromise) return;
    const browserPromise = this.browserPromise;
    this.browserPromise = undefined;
    await browserPromise.then((browser) => browser.close()).catch(() => undefined);
  }

  async execute(id: string, command: BrowserCommand): Promise<ToolResult<unknown>> {
    const record = this.get(id);
    const actionId = randomUUID();
    const started = Date.now();
    record.status = "running";
    this.touch(id);

    try {
      const data = await this.withTimeout(this.executeCommand(record, command), record.policy.maxActionMs ?? 30_000);
      const result: ToolSuccess<unknown> = {
        ok: true,
        data,
        sessionId: id,
        actionId,
        durationMs: Date.now() - started,
      };
      return result;
    } catch (error) {
      const normalized = error instanceof BrowserKitError
        ? error
        : new BrowserKitError(errorCodes.internal, error instanceof Error ? error.message : "Browser action failed", { cause: error });
      const result: ToolFailure = {
        ok: false,
        error: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
          ...(normalized.details ? { details: normalized.details } : {}),
        },
        sessionId: id,
        actionId,
        durationMs: Date.now() - started,
      };
      return result;
    }
  }

  private trackTab(record: SessionRecord, page: Page): TabRecord {
    const tab: TabRecord = { id: randomUUID(), page, createdAt: Date.now() };
    record.tabs.set(tab.id, tab);
    page.on("framenavigated", () => this.touch(record.id));
    page.on("close", () => {
      record.tabs.delete(tab.id);
      if (record.activeTabId === tab.id) {
        const replacement = [...record.tabs.values()].at(-1);
        if (replacement) {
          record.activeTabId = replacement.id;
          record.page = replacement.page;
        }
      }
      if (this.sessions.has(record.id)) this.touch(record.id);
    });
    return tab;
  }

  private async openPage(page: Page, url: string): Promise<void> {
    try {
      this.assertUrlAllowed(url, { allowEvaluate: false });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch {
      // A temporary remote navigation failure must not prevent a ready session.
    }
  }

  private async executeCommand(record: SessionRecord, command: BrowserCommand): Promise<unknown> {
    const page = record.page;
    switch (command.type) {
      case "navigate":
        this.assertUrlAllowed(command.url, record.policy);
        await page.goto(command.url, { waitUntil: "domcontentloaded" });
        return { url: page.url(), title: await page.title() };
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded" });
        return { url: page.url(), title: await page.title() };
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded" });
        return { url: page.url(), title: await page.title() };
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded" });
        return { url: page.url(), title: await page.title() };
      case "observe":
        return this.observe(record);
      case "click": {
        const clickOptions: { button?: "left" | "middle" | "right"; clickCount?: number } = {};
        if (command.button) clickOptions.button = command.button;
        if (command.clickCount) clickOptions.clickCount = command.clickCount;
        if (command.x !== undefined && command.y !== undefined) await page.mouse.click(command.x, command.y, clickOptions);
        else await this.locator(page, command.ref, command.selector).click(clickOptions);
        return { url: page.url(), title: await page.title() };
      }
      case "fill":
        await this.locator(page, command.ref, command.selector).fill(command.value);
        return { filled: true };
      case "type": {
        const typeOptions: { delay?: number } = {};
        if (command.delayMs !== undefined) typeOptions.delay = command.delayMs;
        await this.locator(page, command.ref, command.selector).pressSequentially(command.text, typeOptions);
        return { typed: true };
      }
      case "press":
        await page.keyboard.press(command.key);
        return { pressed: command.key };
      case "scroll":
        await page.mouse.wheel(command.deltaX ?? 0, command.deltaY ?? 600);
        return { scrolled: true };
      case "hover":
        if (command.x !== undefined && command.y !== undefined) await page.mouse.move(command.x, command.y);
        else await this.locator(page, command.ref, command.selector).hover();
        return { hovered: true };
      case "screenshot": {
        const buffer = await page.screenshot({ fullPage: command.fullPage ?? false, type: command.format ?? "png" });
        return { mimeType: `image/${command.format ?? "png"}`, base64: buffer.toString("base64") };
      }
      case "pdf": {
        const buffer = await page.pdf({ format: "A4", printBackground: true });
        return { mimeType: "application/pdf", base64: buffer.toString("base64") };
      }
      case "wait":
        if (command.selector) await page.waitForSelector(command.selector);
        else if (command.url) await page.waitForURL(command.url);
        else await page.waitForTimeout(Math.min(command.ms ?? 250, 10_000));
        return { waited: true };
      case "evaluate":
        if (!record.policy.allowEvaluate) throw new BrowserKitError(errorCodes.policyDenied, "JavaScript evaluation is disabled by session policy", { status: 403 });
        return page.evaluate(command.expression);
      case "close":
        await this.close(record.id, "agent_requested");
        return { closed: true };
    }
  }

  private async observe(record: SessionRecord): Promise<PageSnapshot> {
    const observationId = randomUUID();
    const elements = await record.page.evaluate((id) => {
      const nodes = [...document.querySelectorAll<HTMLElement>("a,button,input,textarea,select,[role=button],[role=link],[contenteditable=true]")];
      return nodes.slice(0, 250).map((node, index) => {
        const ref = `bk-${id}-${index}`;
        node.setAttribute("data-browser-kit-ref", ref);
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const item: InteractiveElement = {
          ref,
          tagName: node.tagName.toLowerCase(),
          disabled: (node as HTMLButtonElement).disabled ?? node.getAttribute("aria-disabled") === "true",
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        const role = node.getAttribute("role");
        const name = node.getAttribute("aria-label") ?? node.getAttribute("name");
        const text = (node.innerText || node.textContent || "").trim().slice(0, 240);
        const value = "value" in node && typeof (node as HTMLInputElement).value === "string" ? (node as HTMLInputElement).value.slice(0, 240) : "";
        const placeholder = node.getAttribute("placeholder");
        const href = node instanceof HTMLAnchorElement ? node.href : "";
        if (role) item.role = role;
        if (name) item.name = name;
        if (text) item.text = text;
        if (value) item.value = value;
        if (placeholder) item.placeholder = placeholder;
        if (href) item.href = href;
        return item;
      });
    }, observationId);
    const snapshot: PageSnapshot = {
      observationId,
      url: record.page.url(),
      title: await record.page.title(),
      text: (await record.page.locator("body").innerText().catch(() => "")).slice(0, 20_000),
      elements,
      capturedAt: new Date().toISOString(),
    };
    record.currentObservationId = observationId;
    return snapshot;
  }

  private locator(page: Page, ref?: string, selector?: string) {
    if (ref) return page.locator(`[data-browser-kit-ref="${ref.replaceAll('"', "\\\"")}"]`).first();
    if (selector) return page.locator(selector).first();
    throw new BrowserKitError(errorCodes.invalidRequest, "An element ref or selector is required", { status: 400 });
  }

  private assertUrlAllowed(rawUrl: string, policy: SessionPolicy): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BrowserKitError(errorCodes.invalidRequest, "Invalid navigation URL", { status: 400 });
    }
    if (!/^https?:$/.test(url.protocol)) throw new BrowserKitError(errorCodes.policyDenied, "Only HTTP(S) navigation is allowed", { status: 403 });
    if (policy.blockedOrigins?.some((origin) => url.origin === origin)) throw new BrowserKitError(errorCodes.policyDenied, "Navigation blocked by session policy", { status: 403 });
    if (policy.allowedOrigins && !policy.allowedOrigins.includes(url.origin)) throw new BrowserKitError(errorCodes.policyDenied, "Navigation origin is not allowlisted", { status: 403 });
  }

  private touch(id: string): void {
    const record = this.sessions.get(id);
    if (!record) return;
    record.lastActivityAt = Date.now();
    const idleTimeoutSeconds = record.options.idleTimeoutSeconds ?? this.config.defaultIdleTimeoutSeconds;
    clearTimeout(record.idleTimer);
    record.idleTimer = setTimeout(() => void this.close(id, "idle_timeout"), idleTimeoutSeconds * 1000);
  }

  private summary(record: SessionRecord): SessionSummary {
    const summary: SessionSummary = {
      id: record.id,
      status: record.status,
      createdAt: new Date(record.createdAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(),
      lastActivityAt: new Date(record.lastActivityAt).toISOString(),
      labels: record.options.labels ?? {},
    };
    const url = record.page.url();
    if (url && url !== "about:blank") summary.currentUrl = url;
    if (record.page.url()) summary.title = "";
    if (record.options.tenantId) summary.tenantId = record.options.tenantId;
    if (record.options.agentId) summary.agentId = record.options.agentId;
    if (record.options.taskId) summary.taskId = record.options.taskId;
    return summary;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BrowserKitError(errorCodes.actionTimeout, "Browser action timed out", { retryable: true, status: 504 })), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
