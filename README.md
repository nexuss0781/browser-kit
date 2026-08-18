# Browser Kit

[![npm version](https://img.shields.io/npm/v/browser-kit?logo=npm)](https://www.npmjs.com/package/browser-kit)
[![CI status](https://img.shields.io/badge/tests-20%20passing-success)](https://github.com/nexuss0781/browser-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Browser Kit** is an AI-facing remote Chromium control platform. It combines a Docker-hosted browser engine, a TypeScript SDK, JSON-schema agent tools, a REST API, session-scoped WebSocket control, and a secure live browser view in one repository.

It is designed for agents that need to **navigate real websites, inspect rendered pages, interact with controls, complete authorized workflows, collect research evidence, and recover safely from browser failures**. The npm package is the server-side client contract; Chromium and the browser engine run in the separately deployed service.

> Browser Kit is a browser execution and evidence layer. Your agent remains responsible for source selection, reasoning, extraction, citations, domain policy, and user confirmation.

## What Browser Kit provides

| Capability | Description |
| --- | --- |
| Remote Chromium sessions | Create isolated, short-lived or persistent browser sessions with viewport and policy controls. |
| Agent-oriented interaction | Observe the current page, then navigate, click, fill, type, press keys, scroll, hover, wait, and verify outcomes. |
| Evidence capture | Capture PNG, JPEG, WebP, and PDF artifacts, including clipped or adaptive captures. |
| Structured agent tools | Generate nine JSON-schema tools for common browser actions. |
| REST and WebSocket APIs | Integrate from TypeScript, Python, Go, shell, or another service. |
| Live browser view | Mint a short-lived read-only or read/write browser view for a trusted operator. |
| Safety controls | Use origin policy, evaluation policy, session limits, scoped credentials, short-lived view tokens, and canonical error codes. |
| React integration | Embed the live browser panel with `browser-kit/react`. |

## Current release

The current SDK release is [`browser-kit@0.1.5`](https://www.npmjs.com/package/browser-kit/v/0.1.5). The single source branch is [`main`](https://github.com/nexuss0781/browser-kit/tree/main), and the AI skill is stored at [`SKILL/browser-kit/`](SKILL/browser-kit/).

```bash
npm install browser-kit@0.1.5
```

The npm package contains the TypeScript SDK, command and result types, agent-tool adapter, and optional React live-view component. It does not bundle Chromium or the server runtime.

## Quick start

### 1. Start the browser engine locally

```bash
pnpm install
cp .env.example .env
pnpm --filter @browser-kit/server dev
```

The local service listens on `http://localhost:10000` by default. When a local Chromium installation is not available, use the included Docker image:

```bash
docker build -t browser-kit:local .
docker run --rm --env-file .env -p 10000:10000 browser-kit:local
```

Check readiness before creating a session:

```bash
curl http://localhost:10000/health/ready
```

### 2. Install and configure the SDK

```bash
npm install browser-kit@0.1.5
```

Keep the API key in server-side environment variables. Never place it in browser JavaScript, React props, logs, screenshots, or public repositories.

```bash
export BROWSER_KIT_URL=http://localhost:10000
export BROWSER_KIT_API_KEY=replace-with-a-server-side-secret
```

### 3. Run an agent-style browser loop

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
  const observation = await session.page.observe();
  if (!observation.ok) throw new Error(observation.error.message);

  const link = observation.data.elements.find(
    (element) => element.role === "link" && element.name?.includes("More information"),
  );
  if (!link) throw new Error("Expected link was not found");

  const click = await session.page.getByRef(link.ref).click();
  if (!click.ok) throw new Error(click.error.message);

  await session.execute({ type: "wait", ms: 250 });
  const evidence = await session.page.screenshot({ fullPage: true, format: "png" });
  if (!evidence.ok) throw new Error(evidence.error.message);
} finally {
  await session.close();
}
```

The recommended control loop is **observe, act, wait, verify, and capture evidence**. Re-observe after navigation, reload, history navigation, or a stale element-reference error.

## SDK overview

The SDK exposes the following high-level objects:

| Object | Purpose |
| --- | --- |
| `BrowserKit` | Configure the engine connection and create or access sessions. |
| `SessionClient` | Manage session lifecycle and session lookup operations. |
| `BrowserSession` | Execute commands, create batches, mint live views, subscribe to events, and close a session. |
| `Page` | Navigate, observe, capture screenshots/PDFs, evaluate when permitted, and access locators. |
| `Locator` | Click, fill, type, and hover using a selector or current observation ref. |
| `Keyboard` | Send browser keyboard commands. |
| `ControlConnection` | Maintain session-scoped realtime control and event handling. |

The SDK supports 16 normalized browser commands: navigation, reload, history navigation, observation, click, fill, type, key press, scroll, hover, screenshot, PDF, wait, evaluation, and close. Use `executeBatch()` for a deterministic ordered sequence of up to 32 commands.

## Agent tools

Create the common JSON-schema tools from a connected session:

```ts
const tools = await kit.createTools(session.id);
```

The adapter provides:

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

Use `session.execute()` for reload, back, forward, hover, PDF, evaluation, close, adaptive artifact options, and command batches.

## Research workflow

Browser Kit is well suited to research agents working with dynamic or interactive websites. A robust research workflow should create a short-lived session, open the authorized source, observe the rendered page, search or navigate using current refs or stable selectors, wait for dynamic results, record the final URL, extract only the information the agent can verify, and capture screenshots or PDFs when evidence is required.

Agents should distinguish a successful result from a login wall, consent screen, CAPTCHA, anti-bot page, empty result, policy denial, or incomplete navigation. Browser Kit does not authorize bypassing access controls or anti-bot systems.

## Web application workflow

Use Browser Kit from a backend, server action, or trusted worker. A web application may request a short-lived live-view URL and pass only that URL to the frontend:

```ts
const view = await session.liveView("readonly");
console.log(view.url);
```

For trusted operator interaction, request `"readwrite"` and render the URL with the optional React component:

```bash
npm install browser-kit@0.1.5 react
```

```tsx
import { BrowserPanel } from "browser-kit/react";

export function AgentBrowser({ liveViewUrl }: { liveViewUrl: string }) {
  return <BrowserPanel src={liveViewUrl} title="Agent browser" />;
}
```

The API key must remain on the server. The live-view URL is scoped to a session and expires.

## REST API

Use the REST API from any language. Set the server-side authorization header on every protected request:

```bash
export BROWSER_KIT_URL=https://your-browser-kit.example
export BROWSER_KIT_API_KEY=server-side-secret
export AUTH="Authorization: Bearer $BROWSER_KIT_API_KEY"
```

Create a session:

```bash
curl -X POST "$BROWSER_KIT_URL/v1/sessions" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"viewport":{"width":1440,"height":900},"profile":"ephemeral","ttlSeconds":900}'
```

Execute a command:

```bash
curl -X POST "$BROWSER_KIT_URL/v1/sessions/$SESSION_ID/commands" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"command":{"type":"navigate","url":"https://example.com"}}'
```

The main API surface includes health and capability discovery, session CRUD, single commands, ordered command batches, live-view tokens, artifact retrieval, session close, and a session control WebSocket. The complete route and message catalog is in [`docs/api.md`](docs/api.md) and the AI-facing reference is in [`SKILL/browser-kit/references/api_reference.md`](SKILL/browser-kit/references/api_reference.md).

## Security model

Browser Kit is intended to be deployed as a server-side service. Use the following defaults:

| Control | Recommendation |
| --- | --- |
| API credentials | Keep API keys in a secret manager or server-side environment variables. |
| Session profile | Prefer `ephemeral` sessions for ordinary agent tasks. |
| Evaluation | Keep JavaScript evaluation disabled unless the task and target are trusted. |
| Navigation | Use allowed-origin and blocked-origin policy where possible. |
| Network | Keep private-network access disabled unless explicitly authorized. |
| Consequential actions | Require user confirmation before purchases, submissions, deletions, messages, publishing, or security changes. |
| Artifacts | Treat screenshots, PDFs, and page content as potentially sensitive. |
| Lifecycle | Set TTL and idle limits, and close sessions in `finally` blocks. |

Browser Kit reports canonical errors such as `STALE_OBSERVATION`, `ELEMENT_NOT_FOUND`, `SESSION_EXPIRED`, `NAVIGATION_TIMEOUT`, `POLICY_DENIED`, and `BROWSER_DISCONNECTED`. Agents should inspect the error code and retry only when the operation is safe and marked retryable.

## Deployment

The repository includes a Dockerfile and Render blueprint. For deployment configuration, environment variables, cloud authentication, ownership scopes, and operational safeguards, see:

- [`docs/deployment.md`](docs/deployment.md)
- [`docs/cloud-credentials.md`](docs/cloud-credentials.md)
- [`render.yaml`](render.yaml)

The service should listen on `0.0.0.0:$PORT` in hosted environments. Treat in-memory session state as ephemeral: clients must reconnect after process replacement, and production deployments should provide durable storage and routing before scaling across workers.

## Development

Install dependencies and run the full validation suite:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
python /home/ubuntu/skills/skill-creator/scripts/quick_validate.py /home/ubuntu/browser-kit/SKILL/browser-kit
```

The current repository validation covers SDK behavior, server behavior, command contracts, artifacts, sessions, live views, and agent integration.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `packages/browser-kit/src/client.ts` | TypeScript SDK, session client, page, locator, and control connection. |
| `packages/browser-kit/src/types.ts` | Session, command, result, policy, and event contracts. |
| `packages/browser-kit/src/tools.ts` | JSON-schema agent-tool adapter. |
| `packages/browser-kit/src/react/` | Optional React live-view component. |
| `server/src/session-manager.ts` | Chromium session lifecycle and browser command execution. |
| `server/src/http-api.ts` | REST API, session control, live view, and artifact routes. |
| `server/src/index.ts` | Server startup, WebSocket control, live-view page, and shutdown. |
| `SKILL/browser-kit/` | AI-facing Browser Kit operating skill and detailed API reference. |
| `docs/` | User-facing API, deployment, cloud credential, architecture, and roadmap documentation. |

## Documentation

| Resource | Link |
| --- | --- |
| AI-facing skill | [`SKILL/browser-kit/SKILL.md`](SKILL/browser-kit/SKILL.md) |
| Complete AI API reference | [`SKILL/browser-kit/references/api_reference.md`](SKILL/browser-kit/references/api_reference.md) |
| User-facing API documentation | [`docs/api.md`](docs/api.md) |
| Deployment guide | [`docs/deployment.md`](docs/deployment.md) |
| Cloud credentials | [`docs/cloud-credentials.md`](docs/cloud-credentials.md) |
| Architecture notes | [`docs/architecture.md`](docs/architecture.md) |
| npm package | [`browser-kit`](https://www.npmjs.com/package/browser-kit) |
| Issues and discussions | [`GitHub repository`](https://github.com/nexuss0781/browser-kit) |

## License

Browser Kit is released under the [MIT License](LICENSE).

## References

[1]: https://github.com/nexuss0781/browser-kit "Browser Kit repository"
[2]: https://www.npmjs.com/package/browser-kit "Browser Kit on npm"
[3]: https://playwright.dev/docs/api/class-browser "Playwright Browser API"
