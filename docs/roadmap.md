# Roadmap

## Shipped in `0.1.0`

The current release provides the small TypeScript client, session lifecycle, isolated Chromium contexts, normalized browser commands, observation snapshots, Nexus JSON-schema tools, scoped control and live-view tokens, a React `BrowserPanel`, screenshot-based live view, HTTP command execution, WebSocket control, Docker packaging, Render configuration, health endpoints, and engineer-facing API documentation.

## Next milestone: playground integration

Build the Nexus playground adapter around `createBrowserTools()`. The adapter should display the agent action timeline, show the current observation, render the live-view URL in a right-side browser panel, allow read-only and read/write modes, expose a clear human-takeover button, and close the session when the task completes or is cancelled.

The playground should keep the engine API key on the server. It should mint the live-view token through a trusted backend route, pass only the token-scoped URL to the frontend, and remove the panel when the engine posts `browser-kit-disconnected`.

## Next milestone: production browser transport

Replace screenshot polling with a low-latency WebRTC transport with TURN relay support and retain screenshot or WebSocket image streaming as a fallback. Add browser-stream backpressure, viewport synchronization, cursor state, focus handling, input arbitration, and explicit agent-versus-user locks.

## Next milestone: durable sessions

Externalize session metadata, worker leases, event cursors, profile references, and artifact manifests. Route every command to the worker holding the browser context. Add reconnect and migration semantics for deploys, crashes, and worker replacement.

## Next milestone: security hardening

Add tenant authorization on every resource, strict live-view origin allowlists, domain and port egress policies, SSRF and DNS-rebinding defenses, encrypted persistent profiles, secret injection with redaction, rate limits, artifact retention, and audit exports.

## Next milestone: full browser compatibility

Add a scoped CDP proxy, Playwright and Puppeteer connection helpers, capability negotiation, Chromium version compatibility reporting, network interception, file artifacts, trace recording, mobile emulation, WebAuthn testing, and optional extension support. Keep the high-level SDK small and expose advanced Chromium features through explicit opt-in adapters.
