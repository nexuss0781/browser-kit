---
name: browser-kit
description: AI-facing Browser Kit usage for controlling remote Chromium through the TypeScript SDK, REST API, agent tools, live view, and WebSocket events. Use when an AI must browse, inspect, click, fill, type, scroll, wait, capture screenshots or PDFs, execute ordered browser workflows, recover from browser errors, or configure a Browser Kit environment end to end.
---

# Browser Kit for AI browser control

Use Browser Kit when the task requires a real browser: opening websites, reading rendered pages, interacting with forms, following links, collecting evidence, or returning screenshots and PDFs. Prefer the published TypeScript SDK for application code and the generated agent tools when the host agent can call tools directly. Use REST when integrating from another language or debugging the service.

## Operating rules

1. **Keep the API key server-side.** Never put `BROWSER_KIT_API_KEY` in browser JavaScript, React props, logs, screenshots, prompts, or user-visible output. Give a frontend only a short-lived live-view URL.
2. **Use an observation-first loop.** Navigate, observe, choose a visible element, act, wait for the expected result, then observe or capture evidence again.
3. **Use current refs only.** A ref comes from the latest `observe`. If navigation, reload, back, forward, or a stale-ref error occurs, observe again before using refs.
4. **Prefer stable selectors for repeatable workflows.** Use a CSS selector when the page provides a stable semantic selector; use a ref when the AI selected an element from the current observation.
5. **Verify outcomes.** Do not treat a successful HTTP response alone as proof that the browser did the intended thing. Inspect `ok`, inspect `error` on failure, and verify the page state with `observe`, `wait`, a screenshot, or a PDF.
6. **Ask for confirmation before irreversible external actions.** Examples include purchasing, submitting a legal or financial form, sending a message, deleting data, changing account security, or publishing content.
7. **Respect policy failures.** Do not bypass `POLICY_DENIED`, origin restrictions, disabled evaluation, or private-network blocking. Change policy only when the user explicitly authorizes it and the environment is trusted.
8. **Close every session.** Use `try/finally` in application code and close sessions after evidence has been captured.

## Choose an integration path

| Situation | Use |
|---|---|
| Node.js or TypeScript application | `browser-kit@0.1.5` SDK |
| AI host with JSON-schema tool calling | `createBrowserTools()` |
| Python, Go, shell, or service integration | REST API |
| Live operator view | `session.liveView()` and `BrowserPanel` or an iframe |
| Realtime events or long-lived control | `session.events()` / control WebSocket |

Read `references/api_reference.md` when exact request shapes, route details, SDK signatures, or advanced examples are needed.

## Environment setup

### Client installation

```bash
npm install browser-kit@0.1.5
```

Set these variables in the application that controls the browser:

```bash
BROWSER_KIT_URL=https://your-browser-kit-service.example
BROWSER_KIT_API_KEY=replace-with-a-secret
```

For a local engine, the service normally listens on port `10000`:

```bash
curl http://localhost:10000/health/ready
```

The engine service can be started from the repository with Docker:

```bash
cp .env.example .env
docker build -t browser-kit:local .
docker run --rm --env-file .env -p 10000:10000 browser-kit:local
```

Useful server settings are `PORT`, `BROWSER_KIT_API_KEY`, `BROWSER_KIT_PUBLIC_URL`, `BROWSER_EXECUTABLE_PATH`, `BROWSER_MAX_SESSIONS`, `BROWSER_DEFAULT_TTL_SECONDS`, `BROWSER_DEFAULT_IDLE_TIMEOUT_SECONDS`, and `BROWSER_ALLOW_EVALUATE`. Keep evaluation disabled unless the agent is trusted and the target pages are trusted.

### Create the SDK client

```ts
import { BrowserKit } from "browser-kit";

const kit = new BrowserKit({
  baseUrl: process.env.BROWSER_KIT_URL!,
  apiKey: process.env.BROWSER_KIT_API_KEY,
  tenantId: process.env.BROWSER_KIT_TENANT_ID,
  timeoutMs: 30_000,
  reconnect: true,
  maxReconnectAttempts: 6,
});
```

## Standard end-to-end workflow

Use this workflow for most browser tasks:

```ts
const session = await kit.createSession({
  viewport: { width: 1440, height: 900 },
  profile: "ephemeral",
  ttlSeconds: 900,
  policy: { allowEvaluate: false, allowPrivateNetwork: false },
});

try {
  await session.page.goto("https://example.com");

  const snapshot = await session.page.observe();
  if (!snapshot.ok) throw new Error(snapshot.error.message);

  const link = snapshot.data.elements.find((element) =>
    element.role === "link" && element.name?.includes("More information"),
  );
  if (!link) throw new Error("Expected link was not found");

  const click = await session.page.getByRef(link.ref).click();
  if (!click.ok) throw new Error(click.error.message);

  const settled = await session.execute({ type: "wait", ms: 250 });
  if (!settled.ok) throw new Error(settled.error.message);

  const evidence = await session.page.screenshot({ fullPage: true, format: "png" });
  if (!evidence.ok) throw new Error(evidence.error.message);
} finally {
  await session.close();
}
```

For a known page, the shorter selector workflow is usually clearer:

```ts
const session = await kit.createSession({ profile: "ephemeral" });
try {
  await session.page.goto("https://example.com/login");
  await session.page.locator("input[name=email]").fill(userEmail);
  await session.page.locator("input[name=password]").fill(userPassword);
  await session.page.locator("button[type=submit]").click();
  await session.execute({ type: "wait", selector: "[data-testid=dashboard]" });
  const result = await session.page.observe();
} finally {
  await session.close();
}
```

## AI decision procedure

When given a browser task, follow these decisions in order:

1. Create a short-lived ephemeral session unless the user explicitly needs a persistent profile.
2. Set the smallest viewport, timeout, origin policy, and capabilities required.
3. Navigate to the requested page.
4. Observe after navigation and after every major page transition.
5. Choose an element by ref when the choice came from observation; otherwise use a stable CSS selector.
6. Use `fill` for replacement, `type` for keystroke-like entry, `press` for keys, `click` for activation, `hover` for hover state, and `scroll` for movement.
7. Wait on a selector or URL when possible. Use a short fixed `ms` wait only when no page condition exists.
8. Verify the expected text, URL, title, element, or artifact. Capture a screenshot or PDF when the user needs evidence.
9. On `STALE_OBSERVATION`, observe again and retry once with the new ref. On `SESSION_EXPIRED`, create a fresh session and restart from the last safe checkpoint. On `SESSION_LIMIT`, wait briefly and retry only if `retryable` is true.
10. Close the session and report what was actually verified.

## Common workflows

### Search and inspect

Navigate to the search page, fill the search field, press `Enter`, wait for a result selector, observe the result page, and return the relevant text or screenshot. Treat anti-bot pages, login walls, consent pages, and empty results as different outcomes; do not claim that search succeeded just because navigation succeeded.

### Form completion

Observe first, identify each field, fill only the requested values, verify that required controls are present, and ask for confirmation immediately before the final submit when the action has external consequences.

### Click a result and return evidence

Observe, locate the result by ref or selector, click, wait for the destination URL or selector, observe again, then capture a screenshot or PDF. If the result opens a new tab and the deployment exposes tab APIs, use the console/tab routes described in the reference file.

### Batch a deterministic sequence

Use `executeBatch()` when a known sequence should be sent as one ordered request:

```ts
const batch = await session.executeBatch([
  { type: "fill", selector: "#query", value: "browser kit" },
  { type: "press", key: "Enter" },
  { type: "wait", selector: "[data-result]" },
  { type: "screenshot", fullPage: true, format: "jpeg", adaptive: true },
]);

for (const item of batch.results) {
  if (!item.ok) throw new Error(item.error.message);
}
```

Batches contain 1–32 commands. They run in order and stop on the first failure by default. Set `continueOnError: true` only when later commands are meaningful even if an earlier command fails.

### Use live view

Request a short-lived view URL from server-side code:

```ts
const view = await session.liveView("readonly");
// Send view.url to a trusted UI, not the API key.
```

Use `readwrite` only when the operator must interact manually. The URL is session-scoped and expires. In React, render it with `BrowserPanel` from `browser-kit/react`.

### Capture artifacts

Use standard PNG for lossless evidence. Use adaptive JPEG or WebP when the user wants a smaller visual artifact, and use `clip` to capture only the relevant region. Use PDF when the user needs a document-like page capture. Check returned artifact metadata and retrieve the artifact URL when the inline payload is not convenient.

## Failure recovery

| Error | AI response |
|---|---|
| `UNAUTHORIZED` | Check the server-side API key and base URL; never expose or echo the key. |
| `FORBIDDEN` | Check credentials, scope, ownership, or live-view mode. Do not retry blindly. |
| `NOT_FOUND` | Confirm the session or artifact ID; create a new session if it expired. |
| `INVALID_REQUEST` | Correct the command shape or required fields. |
| `SESSION_LIMIT` | Wait and retry if marked retryable; reduce concurrency or create fewer sessions. |
| `SESSION_EXPIRED` | Create a new session and restart from a safe checkpoint. |
| `STALE_OBSERVATION` | Run `observe` again and use a new ref. |
| `ELEMENT_NOT_FOUND` | Observe again, verify the selector, or report that the element is absent. |
| `ELEMENT_NOT_ACTIONABLE` | Check visibility, disabled state, overlays, and required scrolling. |
| `NAVIGATION_TIMEOUT` | Verify the URL and network policy, then retry once if retryable. |
| `ACTION_TIMEOUT` | Retry once if safe; otherwise report the incomplete action. |
| `BROWSER_UNAVAILABLE` | Retry after a short delay or report service capacity. |
| `BROWSER_DISCONNECTED` | Reconnect events/control, then retry only idempotent actions. |
| `POLICY_DENIED` | Explain which requested capability was blocked; obtain explicit authorization before changing policy. |
| `INTERNAL_ERROR` | Retry once when marked retryable; preserve the action context and report if it persists. |

## Direct agent tools

When the host agent supports JSON-schema tools, create them from a connected session:

```ts
const tools = await kit.createTools(session.id);
```

The current adapter creates `browser_observe`, `browser_navigate`, `browser_click`, `browser_fill`, `browser_type`, `browser_press`, `browser_scroll`, `browser_screenshot`, and `browser_wait`.

Use the lower-level `session.execute()` API for reload, back, forward, hover, PDF, evaluate, close, and any command not exposed by the adapter.

## Completion checklist

Before saying a browser task is complete, confirm that the intended page was reached, the intended action succeeded, the expected state was verified, any requested screenshot/PDF was actually captured, no policy or login wall changed the outcome, sensitive values were not exposed, and the session was closed.

Read `references/api_reference.md` for the full SDK signatures, REST routes, WebSocket messages, live-view endpoints, session policy fields, command shapes, artifact retrieval, and advanced examples.
