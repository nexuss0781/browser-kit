# browser-kit

`browser-kit` packages the remote Chromium engine, small TypeScript SDK, and an integrated browser control console in one Docker service. Opening the deployed service redirects to **`/app`**, where users register with email and password, create scoped SDK API keys, manage browser sessions, and interact with live Chrome.

When `CLOUD_AUTH_REQUIRED=true`, every `/v1/*` SDK request is validated using a cloud-issued user API key and is restricted to browser sessions owned by that user. `BROWSER_KIT_API_KEY` remains an optional operator bootstrap credential; it is not a shared end-user key.

`browser-kit` is a small TypeScript SDK and Docker-hosted Chromium engine for Nexus agents. The npm package stays dependency-light; Chromium, Playwright Core, the control API, and the live browser surface run in the cloud engine.

## Published package

The client SDK is published on npm as [`browser-kit@0.1.0`](https://www.npmjs.com/package/browser-kit).

```bash
npm install browser-kit@0.1.0
```

The package contains the TypeScript client, normalized command contracts, Nexus tool schemas, and the optional `browser-kit/react` embed component. The Docker engine is deployed separately from this npm package.

## Architecture

The engine exposes one HTTP origin. REST handles session lifecycle and normalized commands. A session-scoped WebSocket carries realtime agent events and commands. The live-view endpoint returns an expiring, permission-scoped browser view that streams fresh screenshots and, in read/write mode, forwards mouse and keyboard input. The engine keeps the API key server-side and never sends it to the embedded panel.

The P0 engine uses a single browser worker inside one Docker service. Session metadata is held in memory for the alpha; production deployments should externalize leases, event cursors, profiles, and artifacts before scaling to multiple workers.

## Quickstart

```bash
pnpm install
cp .env.example .env
pnpm --filter browser-kit build
pnpm --filter @browser-kit/server build
pnpm --filter @browser-kit/server dev
```

The local engine listens on `http://localhost:10000` by default. If Chromium is not installed locally, use Docker:

```bash
docker build -t browser-kit .
docker run --rm -p 10000:10000 --env-file .env browser-kit
```

## TypeScript SDK

```bash
npm install browser-kit@0.1.0
```

```ts
import { BrowserKit } from "browser-kit";

const kit = new BrowserKit({
  baseUrl: process.env.BROWSER_KIT_URL!,
  apiKey: process.env.BROWSER_KIT_CLOUD_API_KEY!,
});

const session = await kit.createSession({
  viewport: { width: 1440, height: 900 },
  profile: "ephemeral",
});

await session.page.goto("https://example.com");
const snapshot = await session.page.observe();
console.log(snapshot);

const link = session.page.locator("a");
await link.click();

const liveView = await session.liveView("readwrite");
console.log(liveView.url);

await session.close();
```

The client also exposes `kit.sessions.create`, `kit.sessions.list`, `kit.sessions.get`, `session.connect`, `page.getByRef`, `page.locator`, `locator.click`, `locator.fill`, `locator.type`, `locator.hover`, `page.keyboard.press`, `page.screenshot`, `page.pdf`, and `page.evaluate` when the session policy permits evaluation.

## Get a cloud SDK key

Open the deployed control panel at [`https://browser-kit.onrender.com/app`](https://browser-kit.onrender.com/app), register with an email address and password, and then open **Settings**. Create a named key and select only the scopes your integration needs. The key is displayed **once**; save it immediately in your server-side secret manager as `BROWSER_KIT_CLOUD_API_KEY`.

| Scope | Allows |
| --- | --- |
| `sessions:read` | List and retrieve browser sessions owned by the key’s user. |
| `sessions:control` | Create sessions, connect, and execute browser commands. |
| `sessions:view` | Mint scoped live-view URLs for owned sessions. |
| `sessions:close` | Close owned sessions. |

Never expose this key in browser code, an iframe, a React client bundle, or a public repository. Revoke it from **Settings** if an integration is removed or a secret may have been disclosed.

## React live view

The optional React entrypoint is tree-shakable and is not included in the core package runtime:

```bash
npm install browser-kit react
```

```tsx
import { BrowserPanel } from "browser-kit/react";

export function AgentBrowser({ liveViewUrl }: { liveViewUrl: string }) {
  return <BrowserPanel src={liveViewUrl} title="Agent browser" />;
}
```

Generate the URL on the server with `await session.liveView("readonly")` or `await session.liveView("readwrite")`, then pass only the signed, short-lived URL to the user interface.

## Nexus agent tools

```ts
const tools = await kit.createTools(session.id);

for (const tool of tools) {
  console.log(tool.name, tool.inputSchema);
}
```

The tool adapter includes `browser_observe`, `browser_navigate`, `browser_click`, `browser_fill`, `browser_type`, `browser_press`, `browser_scroll`, `browser_screenshot`, and `browser_wait`. Every execution returns `{ ok, data, error, sessionId, actionId, durationMs }`. The `observationId` option is available for the playground to reject stale element references.

## HTTP API

With cloud authentication enabled, all SDK routes use `Authorization: Bearer <cloud-issued API key>`. The cloud maps the key to its user, checks its scopes, and permits access only to that user’s browser sessions. The live-view iframe uses only its short-lived view token. The optional `BROWSER_KIT_API_KEY` environment variable retains operator access for recovery and deployment administration.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Redirect to the integrated `/app` browser control console. |
| `GET` | `/app` | Built-in direct browser control console served by the engine container. |
| `GET` | `/health/live` | Process liveness. |
| `GET` | `/health/ready` | Capacity and readiness. |
| `GET` | `/v1/capabilities` | Engine and command capability discovery. |
| `POST` | `/v1/sessions` | Create an isolated browser session. |
| `GET` | `/v1/sessions` | List active sessions. |
| `GET` | `/v1/sessions/:id` | Retrieve one session. |
| `POST` | `/v1/sessions/:id/connect` | Mint a short-lived control WebSocket URL. |
| `POST` | `/v1/sessions/:id/commands` | Execute one normalized browser command. |
| `POST` | `/v1/sessions/:id/live-view` | Mint a read-only or read/write view token. |
| `GET` | `/v1/sessions/:id/live-view` | Render the token-scoped browser panel. |
| `GET` | `/v1/sessions/:id/live-view/screenshot` | Return the current browser screenshot. |
| `POST` | `/v1/sessions/:id/live-view/command` | Forward a read/write panel command. |
| `POST` | `/v1/sessions/:id/close` | Close a session and clean its browser context. |
| `WS` | `/v1/sessions/:id/control?token=...` | Realtime session control and events. |

Example session creation:

```bash
curl -X POST "$BROWSER_KIT_URL/v1/sessions" \
  -H "authorization: Bearer $BROWSER_KIT_CLOUD_API_KEY" \
  -H "content-type: application/json" \
  -d '{"viewport":{"width":1440,"height":900},"profile":"ephemeral"}'
```

Example command:

```bash
curl -X POST "$BROWSER_KIT_URL/v1/sessions/$SESSION_ID/commands" \
  -H "authorization: Bearer $BROWSER_KIT_CLOUD_API_KEY" \
  -H "content-type: application/json" \
  -d '{"command":{"type":"navigate","url":"https://example.com"}}'
```

## Render deployment

Render requires the server to listen on `0.0.0.0:$PORT`; the included Dockerfile does this through the server configuration. The included `render.yaml` creates the Docker web service, the `browser-kit-cloud` Postgres instance, `DATABASE_URL`, a generated `CLOUD_SESSION_SECRET`, and `CLOUD_AUTH_REQUIRED=true`. Set `BROWSER_KIT_PUBLIC_URL=https://browser-kit.onrender.com` in Render. `BROWSER_KIT_API_KEY` is optional and should be treated only as an operator bootstrap credential. Start with a low `BROWSER_MAX_SESSIONS` value and raise it only after measuring memory and CPU per Chromium session.

The alpha uses in-memory session state. Before using multiple instances, externalize session leases and metadata, add object storage for artifacts, and route every session to the worker holding its browser context. Render can replace instances during deploys and maintenance, so clients must reconnect and the system must not treat process memory as durable state.

## Security defaults

The engine rejects non-HTTP(S) navigation, supports origin allowlists and blocklists, denies JavaScript evaluation unless explicitly enabled, uses short-lived scoped control and view tokens, isolates browser contexts per session, limits session TTL and idle time, and redacts API secrets from the frontend by design. Add an origin allowlist, egress policy, encrypted persistent profiles, and external artifact storage before production use.

## Current P0 scope

The published P0 supports isolated Chromium sessions, session TTL and idle cleanup, navigation, observation snapshots, locator and coordinate click, fill, type, keyboard press, scroll, hover, screenshots, PDF generation, waits, policy-gated JavaScript evaluation, token-scoped live views, read/write screenshot-panel input, session WebSockets, and Nexus JSON-schema tools.

The live view currently uses screenshot polling with HTTP input forwarding. WebRTC/TURN streaming, durable session storage, multi-worker routing, artifact object storage, persistent encrypted profiles, and a full raw-CDP proxy remain planned production milestones. Do not treat the current in-memory session registry as durable across Render instance replacement.

## Documentation map

- [API reference](docs/api.md) — HTTP, WebSocket, command, live-view, and error contracts.
- [Cloud credentials](docs/cloud-credentials.md) — user accounts, API-key storage, ownership, scopes, and Render configuration.
- [Architecture](docs/architecture.md) — control-plane boundaries, session isolation, reconnect behavior, and future worker splitting.
- [Nexus example](examples/nexus-agent.ts) — agent tool creation and live-view handoff.
- [Published package](https://www.npmjs.com/package/browser-kit) — npm install and package metadata.
- [GitHub repository](https://github.com/nexuss0781/browser-kit) — source, issues, and deployment files.

## Development commands

```bash
pnpm --filter browser-kit typecheck
pnpm --filter @browser-kit/server typecheck
pnpm --filter browser-kit build
pnpm --filter @browser-kit/server build
pnpm test
```

## Project layout

| Path | Responsibility |
| --- | --- |
| `packages/browser-kit/src/client.ts` | TypeScript SDK and reconnect-aware control client. |
| `packages/browser-kit/src/types.ts` | Shared session, command, result, and event contracts. |
| `packages/browser-kit/src/tools.ts` | Nexus JSON-schema agent-tool adapter. |
| `packages/browser-kit/src/react/` | Optional live-view embed component. |
| `server/src/session-manager.ts` | Chromium lifecycle and normalized browser command execution. |
| `server/src/http-api.ts` | REST API, token minting, health endpoints, and live-view APIs. |
| `server/src/index.ts` | Render server, control WebSocket, live-view page, and graceful shutdown. |
| `Dockerfile` | Multi-stage production image with Chromium. |
| `render.yaml` | Render deployment blueprint. |
