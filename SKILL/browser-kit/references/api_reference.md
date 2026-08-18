# Browser Kit API reference for AI agents

Use this file when the task needs exact fields, routes, or advanced usage. The published client is `browser-kit@0.1.5`.

## 1. SDK exports

```ts
import {
  BrowserKit,
  SessionClient,
  BrowserSession,
  ConnectedBrowser,
  Page,
  Locator,
  Keyboard,
  ControlConnection,
  BrowserKitError,
  errorCodes,
  createBrowserTools,
} from "browser-kit";
```

`browser-kit/react` exports `BrowserPanel`.

### Client configuration

```ts
interface BrowserKitOptions {
  baseUrl: string;
  apiKey?: string;
  tenantId?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}
```

`baseUrl` is the engine URL. `apiKey` is sent as `Authorization: Bearer ...`. `tenantId` is sent as `x-tenant-id`. Keep both server-side.

## 2. Session contract

### Session creation

```ts
interface CreateSessionOptions {
  tenantId?: string;
  agentId?: string;
  taskId?: string;
  labels?: Record<string, string>;
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
  };
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

interface SessionPolicy {
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
```

Use `profile: "ephemeral"` for ordinary AI tasks. Use `persistent` only when the user explicitly needs a reusable browser profile and the deployment supports it.

### Session methods

```ts
kit.createSession(options?): Promise<BrowserSession>
kit.connect(sessionId): Promise<ConnectedBrowser>
kit.sessions.create(options?): Promise<BrowserSession>
kit.sessions.list(): Promise<SessionSummary[]>
kit.sessions.get(id): Promise<BrowserSession>
session.connect(): Promise<ConnectedBrowser>
session.execute(command, options?): Promise<ToolResult<unknown>>
session.executeOrThrow<T>(command, options?): Promise<T>
session.executeBatch(commands, options?): Promise<BrowserCommandBatchResult>
session.liveView(mode?: "readonly" | "readwrite"): Promise<LiveViewToken>
session.events(options): Promise<ControlConnection>
session.close(): Promise<void>
```

`ToolCallOptions`:

```ts
interface ToolCallOptions {
  timeoutMs?: number;
  dryRun?: boolean;
  requireConfirmation?: boolean;
  observationId?: string;
  signal?: AbortSignal;
}
```

## 3. Commands

```ts
type BrowserCommand =
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
  | { type: "screenshot"; fullPage?: boolean; format?: "png" | "jpeg" | "webp"; quality?: number; scale?: "css" | "device"; clip?: Clip; adaptive?: boolean }
  | { type: "pdf"; adaptive?: boolean; landscape?: boolean; preferCSSPageSize?: boolean }
  | { type: "wait"; ms?: number; selector?: string; url?: string }
  | { type: "evaluate"; expression: string }
  | { type: "close" };

interface Clip { x: number; y: number; width: number; height: number }
```

### Command meanings

| Command | Use it for | Verify with |
|---|---|---|
| `navigate` | Open or change a URL | URL/title, observe |
| `reload` | Refresh current page | URL/title, observe |
| `back` / `forward` | History navigation | URL/title, observe |
| `observe` | Read page text and interactive elements | `PageSnapshot` |
| `click` | Activate a button, link, checkbox, or coordinate | Result state, URL, observe |
| `fill` | Replace input/textarea/contenteditable text | Observe field value or result |
| `type` | Simulate typing into a selected element | Observe field or result |
| `press` | Send a key or shortcut | Result state or focused element |
| `scroll` | Move the page or container | Observe or screenshot |
| `hover` | Trigger hover behavior | Screenshot or observe |
| `screenshot` | Produce visual evidence | Artifact metadata and image |
| `pdf` | Produce document evidence | Artifact metadata and valid PDF |
| `wait` | Wait for milliseconds, selector, or URL | Follow with observe |
| `evaluate` | Run page JavaScript | Returned value; only when policy allows |
| `close` | End a session | Close response |

## 4. Page and locator methods

```ts
session.page.locator(selector): Locator
session.page.getByRef(ref): Locator
session.page.goto(url, options?): Promise<ToolResult<unknown>>
session.page.observe(options?): Promise<ToolResult<PageSnapshot>>
session.page.screenshot(options?): Promise<ToolResult<unknown>>
session.page.pdf(options?): Promise<ToolResult<unknown>>
session.page.evaluate(expression, options?): Promise<ToolResult<unknown>>
session.page.keyboard.press(key, options?): Promise<ToolResult<unknown>>

locator.click(options?): Promise<ToolResult<unknown>>
locator.fill(value, options?): Promise<ToolResult<unknown>>
locator.type(text, options?: ToolCallOptions & { delayMs?: number }): Promise<ToolResult<unknown>>
locator.hover(options?): Promise<ToolResult<unknown>>
```

### Screenshot options

```ts
await session.page.screenshot({
  fullPage: true,
  format: "jpeg", // "png" | "jpeg" | "webp"
  quality: 78,
  scale: "css", // "css" | "device"
  clip: { x: 0, y: 0, width: 1000, height: 700 },
  adaptive: true,
});
```

Use PNG for lossless evidence, JPEG for photographs or smaller full-page output, WebP for compact clipped or web content, and `clip` when only a region matters. The result may include artifact metadata such as `artifactId`, `artifactUrl`, `mimeType`, `bytes`, and expiration information.

### PDF options

```ts
await session.page.pdf({
  adaptive: true,
  landscape: false,
  preferCSSPageSize: true,
});
```

## 5. Observation and refs

`observe` returns:

```ts
interface PageSnapshot {
  observationId: string;
  url: string;
  title: string;
  text: string;
  elements: InteractiveElement[];
  capturedAt: string;
}

interface InteractiveElement {
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
```

Use `element.ref` immediately with `getByRef`. Refresh the observation after navigation, reload, back, forward, or `STALE_OBSERVATION`. Use a selector instead of a ref for repeatable known-page workflows.

## 6. Results, errors, and timing

```ts
interface ToolSuccess<T> {
  ok: true;
  data: T;
  sessionId: string;
  actionId: string;
  durationMs: number;
  timings?: { admissionMs: number; browserMs: number; totalMs: number };
}

interface ToolFailure {
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
  timings?: { admissionMs: number; browserMs: number; totalMs: number };
}
```

Use `session.executeOrThrow()` when application control flow should use exceptions. Use `execute()` when the AI needs to inspect the failure envelope and decide what to do.

Canonical error codes:

| Code | AI action |
|---|---|
| `UNAUTHORIZED` | Fix server-side credentials or URL; do not retry blindly. |
| `FORBIDDEN` | Check scope, ownership, or live-view mode. |
| `NOT_FOUND` | Confirm session/artifact ID or create a fresh session. |
| `INVALID_REQUEST` | Correct fields and command shape. |
| `SESSION_LIMIT` | Retry after delay if `retryable`; reduce sessions/concurrency. |
| `SESSION_EXPIRED` | Create a new session and restart from a safe checkpoint. |
| `STALE_OBSERVATION` | Observe again and use a new ref. |
| `ELEMENT_NOT_FOUND` | Observe again; fix selector or report absence. |
| `ELEMENT_NOT_ACTIONABLE` | Check visibility, disabled state, overlays, and scroll position. |
| `NAVIGATION_TIMEOUT` | Verify URL/policy and retry once if safe. |
| `ACTION_TIMEOUT` | Retry once if safe; report incomplete action if not. |
| `BROWSER_UNAVAILABLE` | Retry after delay or report capacity. |
| `BROWSER_DISCONNECTED` | Reconnect, then retry only idempotent actions. |
| `POLICY_DENIED` | Explain blocked capability; request explicit authorization if appropriate. |
| `INTERNAL_ERROR` | Retry once when marked retryable, then report. |

## 7. Ordered batches

```ts
const result = await session.executeBatch([
  { type: "navigate", url: "https://example.com" },
  { type: "observe" },
  { type: "screenshot", fullPage: true, adaptive: true, format: "jpeg" },
], { continueOnError: false });
```

```ts
interface BrowserCommandBatchResult {
  ok: boolean;
  batchId: string;
  sessionId: string;
  results: ToolResult<unknown>[];
  completed: number;
  failed: number;
  durationMs: number;
}
```

The REST batch endpoint accepts 1–32 commands. Commands execute in order. Default behavior stops on the first failure. `continueOnError: true` records failures and continues.

## 8. Agent tools

```ts
const tools = await kit.createTools(session.id);
```

The current JSON-schema adapter creates:

| Tool | Inputs |
|---|---|
| `browser_observe` | None |
| `browser_navigate` | `url` |
| `browser_click` | `ref`, `selector`, `x`, `y`, `button`, `clickCount` |
| `browser_fill` | `ref`, `selector`, `value` |
| `browser_type` | `ref`, `selector`, `text`, `delayMs` |
| `browser_press` | `key` |
| `browser_scroll` | `x`, `y`, `deltaX`, `deltaY` |
| `browser_screenshot` | `fullPage`, `format` |
| `browser_wait` | `ms`, `selector`, `url` |

Use `session.execute()` for reload, back, forward, hover, PDF, evaluate, close, adaptive screenshot fields, and batches not represented by this adapter.

## 9. REST API

Set:

```bash
export BASE_URL=https://your-browser-kit-service.example
export API_KEY='server-side-secret'
export AUTH="Authorization: Bearer $API_KEY"
```

### Public checks

```bash
curl "$BASE_URL/health/live"
curl "$BASE_URL/health/ready"
curl "$BASE_URL/v1/capabilities" -H "$AUTH"
curl "$BASE_URL/"
```

### Create/list/get/connect/close

```bash
curl -X POST "$BASE_URL/v1/sessions" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"viewport":{"width":1440,"height":900},"profile":"ephemeral","ttlSeconds":900}'

curl "$BASE_URL/v1/sessions" -H "$AUTH"
curl "$BASE_URL/v1/sessions/SESSION_ID" -H "$AUTH"
curl -X POST "$BASE_URL/v1/sessions/SESSION_ID/connect" -H "$AUTH"
curl -X POST "$BASE_URL/v1/sessions/SESSION_ID/close" -H "$AUTH"
```

### Single command

```bash
curl -X POST "$BASE_URL/v1/sessions/SESSION_ID/commands" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"command":{"type":"navigate","url":"https://example.com"}}'
```

### Batch

```bash
curl -X POST "$BASE_URL/v1/sessions/SESSION_ID/commands/batch" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"commands":[{"type":"observe"},{"type":"screenshot","fullPage":true,"adaptive":true,"format":"jpeg"}],"continueOnError":false}'
```

### Live view

```bash
curl -X POST "$BASE_URL/v1/sessions/SESSION_ID/live-view" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"mode":"readonly"}'
```

Use the returned short-lived `url` in an iframe or `BrowserPanel`. Do not send the API key to the browser.

### Artifact retrieval

```bash
curl "$BASE_URL/v1/artifacts/ARTIFACT_ID" -H "$AUTH" --output artifact.bin
```

### Inspect timing

Read both the JSON `timings` object and the HTTP `Server-Timing` header. The command result is authoritative for application logic.

## 10. WebSocket control

Call `POST /v1/sessions/:id/connect`, then open the returned `controlUrl`.

Server messages:

```json
{"type":"connected","sessionId":"SESSION_ID"}
{"type":"command.result","result":{"ok":true,"data":{},"sessionId":"SESSION_ID","actionId":"ACTION_ID","durationMs":11}}
{"type":"pong","at":"2026-08-18T00:00:00.000Z"}
```

Client messages:

```json
{"type":"command","command":{"type":"observe"}}
{"type":"ping"}
```

Event types may include `session.ready`, `session.closed`, `session.reconnecting`, `action.started`, `action.completed`, `action.failed`, `page.changed`, `console.message`, `user.takeover.requested`, `user.takeover.started`, `user.takeover.ended`, and `error`.

## 11. Live-view and React

```ts
const view = await session.liveView("readonly");
```

```tsx
import { BrowserPanel } from "browser-kit/react";

<BrowserPanel
  src={view.url}
  title="Agent browser"
  onEvent={(event) => console.log(event)}
  fallback={<p>Browser unavailable</p>}
/>
```

`BrowserPanel` accepts `src`, `title`, `className`, `style`, `allow`, `fallback`, and `onEvent`. The iframe receives the short-lived view URL. The component can report `browser-kit-disconnected` when the session or token ends.

## 12. Console routes

The unified service may expose an operator console:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/app/api/auth/register` | Register/sign in |
| `POST` | `/app/api/auth/login` | Login |
| `POST` | `/app/api/auth/logout` | Logout |
| `GET` | `/app/api/auth/me` | Current user |
| `GET` | `/app/api/api-keys` | List API keys |
| `POST` | `/app/api/api-keys` | Create API key |
| `POST` | `/app/api/api-keys/:id/revoke` | Revoke API key |
| `GET` | `/app/api/status` | Service status |
| `GET` | `/app/api/sessions` | List console sessions |
| `POST` | `/app/api/sessions` | Create console session |
| `POST` | `/app/api/sessions/:id/close` | Close console session |
| `POST` | `/app/api/sessions/:id/live-view` | Create console live-view URL |
| `POST` | `/app/api/sessions/:id/commands` | Run console command |
| `GET` | `/app/api/sessions/:id/tabs` | List tabs |
| `POST` | `/app/api/sessions/:id/tabs` | Create tab |
| `POST` | `/app/api/sessions/:id/tabs/:tabId/activate` | Activate tab |
| `POST` | `/app/api/sessions/:id/tabs/:tabId/close` | Close tab |
| `GET` | `/app/api/action-log` | Read action log |

Use the `/v1` API for AI/application control. Use `/app` for a trusted human operator.

## 13. Safe end-to-end patterns

### Retry only safe operations

Retry `observe`, `wait`, navigation, screenshot, and idempotent reads when the error is retryable. Do not automatically retry payments, submissions, deletions, messages, or other irreversible actions.

### Recover from stale refs

```ts
const first = await session.page.observe();
if (!first.ok) throw new Error(first.error.message);
const ref = first.data.elements[0]?.ref;
if (!ref) throw new Error("No element");
const action = await session.page.getByRef(ref).click();
if (!action.ok && action.error.code === "STALE_OBSERVATION") {
  const refreshed = await session.page.observe();
  if (!refreshed.ok) throw new Error(refreshed.error.message);
  // Choose a new ref from refreshed.data.elements and retry once.
}
```

### Confirm before submission

Before a consequential click, summarize the target, data, and expected consequence to the user. Wait for explicit confirmation. After confirmation, perform the click and verify the resulting page or receipt.

### Return evidence

When the user requests proof, return the screenshot/PDF artifact reference plus a short statement of what is visible. If the page is a login wall, CAPTCHA, anti-bot page, or policy denial, report that exact outcome instead of describing the intended page.
