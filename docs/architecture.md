# Browser Kit Architecture

## P0 topology

```text
Nexus agent / playground
        |
        | HTTPS REST + session WebSocket
        v
Render Docker web service
  ├── Fastify control API
  ├── SessionManager
  ├── Chromium process and isolated BrowserContexts
  ├── Live-view HTML + screenshot/input gateway
  └── Health and graceful-shutdown handlers
```

The public server uses one port because the hosting platform forwards public traffic to one configured port. REST, control WebSocket, live view, and live-view input are multiplexed by URL path. The SDK does not start a local browser and does not require Playwright as a client dependency.

## Session isolation

Each session creates a separate Chromium `BrowserContext` and page. The session receives a TTL timer and an idle timer. The session policy is copied into the record and governs evaluation, navigation origins, network features, and action timeouts. When the session closes, its timers are cleared, its context is closed, and the shared Chromium process is stopped when no sessions remain.

The P0 uses an in-memory session registry because it is optimized for an alpha single-instance Render deployment. A production multi-worker deployment needs a durable session registry, a worker lease, external artifact storage, and a route that sends each command to the worker holding the browser context.

## Control-plane boundary

The API key is accepted only by the control-plane HTTP API. The control API mints a five-minute control token for the agent WebSocket and a separately scoped live-view token for the frontend. Control tokens are bound to one session; live-view tokens are bound to one session and one mode. The live view never receives the API key.

The browser panel is intentionally less privileged than the agent channel. Read-only panels can only request screenshots. Read/write panels can forward click and keyboard commands, and the server rejects input when the token mode is read-only.

## Reconnect behavior

Render may replace an instance during deployments or maintenance. The SDK treats WebSockets as disposable, reconnects with bounded exponential backoff, and emits server events through one callback. The P0 does not persist browser state across instance replacement; the next production milestone must add profile persistence or a session migration strategy.

## Future worker split

```text
Public API / Auth / Session registry
              |
              | worker lease + session routing
              v
Browser worker A  ── isolated Chromium sessions
Browser worker B  ── isolated Chromium sessions
              |
              +── object storage for screenshots, PDFs, downloads, traces
              +── key-value store for leases, cursors, and metadata
```

The SDK contract should remain unchanged when this split is introduced. Only the engine’s routing and storage internals should change.
