# browser-kit

`browser-kit` is the TypeScript SDK and AI-agent tool adapter for controlling remote Chromium sessions through the Browser Kit engine.

[![npm version](https://img.shields.io/npm/v/browser-kit?logo=npm)](https://www.npmjs.com/package/browser-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

## Install

```bash
npm install browser-kit@0.1.5
```

The package contains the server-side SDK, normalized command and result types, JSON-schema browser tools, and the optional `browser-kit/react` live-view component. Chromium and the browser engine run in the separately deployed Docker service from the [Browser Kit repository](https://github.com/nexuss0781/browser-kit).

## Basic usage

```ts
import { BrowserKit } from "browser-kit";

const kit = new BrowserKit({
  baseUrl: process.env.BROWSER_KIT_URL!,
  apiKey: process.env.BROWSER_KIT_API_KEY,
});

const session = await kit.createSession({
  viewport: { width: 1440, height: 900 },
  profile: "ephemeral",
  ttlSeconds: 900,
  policy: {
    allowEvaluate: false,
    allowPrivateNetwork: false,
  },
});

try {
  await session.page.goto("https://example.com");
  const snapshot = await session.page.observe();
  if (!snapshot.ok) throw new Error(snapshot.error.message);

  const link = snapshot.data.elements.find(
    (element) => element.role === "link",
  );
  if (!link) throw new Error("No link found");

  const result = await session.page.getByRef(link.ref).click();
  if (!result.ok) throw new Error(result.error.message);
} finally {
  await session.close();
}
```

The recommended agent pattern is **observe, act, wait, verify, and capture evidence**. Re-observe after navigation or a stale observation error, and do not claim completion until the expected page state is verified.

## SDK surface

The SDK provides:

- `BrowserKit` for engine configuration and session creation.
- `BrowserSession` for commands, command batches, live-view URLs, realtime events, and cleanup.
- `Page` and `Locator` for navigation, observation, selectors, refs, clicks, form input, keyboard actions, scrolling, hover, screenshots, PDFs, waits, and policy-gated evaluation.
- `createBrowserTools()` for JSON-schema tools that an AI host can register directly.
- `browser-kit/react` for the `BrowserPanel` live-view component.

The normalized command contract covers navigation, reload, back, forward, observe, click, fill, type, press, scroll, hover, screenshot, PDF, wait, evaluate, and close. Use `executeBatch()` for an ordered sequence of up to 32 commands.

## Agent tools

```ts
const tools = await kit.createTools(session.id);
```

The common adapter exposes:

```text
browser_observe
browser_navigate
browser_click
browser_fill
browser_type
browser_press
browser_scroll
browser_screenshot
browser_wait
```

Use `session.execute()` for commands not represented by the common adapter, including PDF, hover, history navigation, evaluation, close, adaptive artifact options, and batches.

## React live view

```bash
npm install browser-kit@0.1.5 react
```

```tsx
import { BrowserPanel } from "browser-kit/react";

export function AgentBrowser({ liveViewUrl }: { liveViewUrl: string }) {
  return <BrowserPanel src={liveViewUrl} title="Agent browser" />;
}
```

Generate the URL on the server:

```ts
const view = await session.liveView("readonly");
```

Pass only the short-lived signed view URL to the frontend. Never expose the Browser Kit API key in browser code, React props, or public logs.

## Error handling

Every SDK command returns a normalized result with `ok`, `data` or `error`, `sessionId`, `actionId`, and timing metadata. Handle errors by code. Re-observe for `STALE_OBSERVATION`, create a new session for `SESSION_EXPIRED`, verify selectors for `ELEMENT_NOT_FOUND`, and retry only safe operations marked retryable. Do not automatically retry submissions, purchases, messages, deletions, or other consequential actions.

## Engine and documentation

The SDK connects to a separately deployed Browser Kit engine. See the repository documentation for:

- [Complete Browser Kit README](https://github.com/nexuss0781/browser-kit#readme)
- [AI-facing Browser Kit skill](https://github.com/nexuss0781/browser-kit/blob/main/SKILL/browser-kit/SKILL.md)
- [AI API reference](https://github.com/nexuss0781/browser-kit/blob/main/SKILL/browser-kit/references/api_reference.md)
- [REST and WebSocket API](https://github.com/nexuss0781/browser-kit/blob/main/docs/api.md)
- [Deployment guide](https://github.com/nexuss0781/browser-kit/blob/main/docs/deployment.md)
- [Cloud credentials](https://github.com/nexuss0781/browser-kit/blob/main/docs/cloud-credentials.md)

## License

MIT. See the [repository license](https://github.com/nexuss0781/browser-kit/blob/main/LICENSE).
