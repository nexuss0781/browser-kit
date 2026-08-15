# Browser Kit API Reference

This document describes the current **browser-kit P0** API as shipped in [`browser-kit@0.1.0`](https://www.npmjs.com/package/browser-kit). Install the client with `npm install browser-kit@0.1.0`; deploy the Chromium engine separately from the repository Docker image.

The API is versioned under `/v1`. The current implementation is optimized for a single Render instance and keeps active session state in memory. Treat session identifiers, control URLs, and live-view URLs as short-lived runtime values.

## Root service endpoint

`GET /` is intentionally unauthenticated and returns service information for operators and deployment checks:

```json
{
  "service": "browser-kit",
  "version": "0.1.0",
  "status": "ok",
  "message": "Remote Chromium engine is running",
  "health": "/health/ready",
  "capabilities": "/v1/capabilities",
  "documentation": "https://github.com/nexuss0781/browser-kit"
}
```

## Authentication

Protected control-plane requests use `Authorization: Bearer <BROWSER_KIT_API_KEY>`. The server should never expose this key to a browser UI. `POST /v1/sessions/:id/connect` returns a short-lived session-scoped WebSocket URL. `POST /v1/sessions/:id/live-view` returns a short-lived view URL scoped to one session and one permission mode.

## Session creation

`POST /v1/sessions` accepts:

```json
{
  "tenantId": "tenant-1",
  "agentId": "agent-1",
  "taskId": "task-1",
  "labels": { "environment": "playground" },
  "viewport": { "width": 1440, "height": 900 },
  "locale": "en-US",
  "timezoneId": "UTC",
  "profile": "ephemeral",
  "ttlSeconds": 1800,
  "idleTimeoutSeconds": 300,
  "policy": {
    "allowEvaluate": false,
    "allowedOrigins": ["https://example.com"],
    "blockedOrigins": ["https://blocked.example"],
    "maxActionMs": 30000,
    "maxPages": 8
  }
}
```

The response is a `SessionSummary`:

```json
{
  "id": "session-id",
  "status": "ready",
  "createdAt": "2026-08-15T10:00:00.000Z",
  "expiresAt": "2026-08-15T10:30:00.000Z",
  "lastActivityAt": "2026-08-15T10:00:00.000Z",
  "labels": { "environment": "playground" }
}
```

## Commands

`POST /v1/sessions/:id/commands` accepts `{ "command": ... }`. The first command set is:

| Command | Required fields | Result |
| --- | --- | --- |
| `navigate` | `url` | Current URL and title. |
| `reload` | none | Current URL and title. |
| `back` | none | Current URL and title. |
| `forward` | none | Current URL and title. |
| `observe` | none | `PageSnapshot` with stable element refs. |
| `click` | `ref`, `selector`, or `x`/`y` | Current URL and title. |
| `fill` | `value` plus `ref` or `selector` | `{ "filled": true }`. |
| `type` | `text` plus `ref` or `selector` | `{ "typed": true }`. |
| `press` | `key` | `{ "pressed": "Enter" }`. |
| `scroll` | optional `deltaX`, `deltaY` | `{ "scrolled": true }`. |
| `hover` | `ref`, `selector`, or `x`/`y` | `{ "hovered": true }`. |
| `screenshot` | optional `fullPage`, `format` | Base64 image payload. |
| `pdf` | none | Base64 PDF payload. |
| `wait` | optional `ms`, `selector`, or `url` | `{ "waited": true }`. |
| `evaluate` | `expression` | Serialized JavaScript result; policy-gated. |
| `close` | none | `{ "closed": true }`. |

A successful command returns:

```json
{
  "ok": true,
  "data": { "url": "https://example.com", "title": "Example Domain" },
  "sessionId": "session-id",
  "actionId": "action-id",
  "durationMs": 104
}
```

A failed command returns:

```json
{
  "ok": false,
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "The requested element was not found",
    "retryable": false
  },
  "sessionId": "session-id",
  "actionId": "action-id",
  "durationMs": 42
}
```

## Observation contract

`observe` returns a compact `PageSnapshot` containing the current URL, title, visible body text, and up to 250 interactive elements. Each element receives a stable `ref` such as `bk-observation-id-3`. The SDK should use the ref for the next action and refresh the observation after navigation or a stale-element failure.

```json
{
  "observationId": "observation-id",
  "url": "https://example.com",
  "title": "Example Domain",
  "text": "Example Domain ...",
  "elements": [
    {
      "ref": "bk-observation-id-0",
      "role": "link",
      "name": "More information...",
      "tagName": "a",
      "text": "More information...",
      "href": "https://iana.org/domains/example",
      "disabled": false,
      "visible": true,
      "x": 24,
      "y": 120,
      "width": 180,
      "height": 24
    }
  ],
  "capturedAt": "2026-08-15T10:00:05.000Z"
}
```

## WebSocket control

The client SDK can use the control WebSocket for realtime events and reconnect handling. Normalized command execution remains available over HTTP, which is the simplest integration path for a Nexus tool executor.

After `POST /v1/sessions/:id/connect`, open the returned `controlUrl`. The first server message is:

```json
{ "type": "connected", "sessionId": "session-id" }
```

Send commands with:

```json
{ "type": "command", "command": { "type": "observe" } }
```

Receive:

```json
{ "type": "command.result", "result": { "ok": true, "data": {}, "sessionId": "session-id", "actionId": "action-id", "durationMs": 11 } }
```

Send `{ "type": "ping" }` for an application-level heartbeat. The server returns `{ "type": "pong", "at": "..." }`. The SDK reconnects with bounded exponential backoff. A future multi-worker engine must preserve event sequence numbers and replay cursors during reconnect.

## Live view

`POST /v1/sessions/:id/live-view` accepts `{ "mode": "readonly" }` or `{ "mode": "readwrite" }`. The returned URL is intended for the `BrowserPanel` React component or a direct iframe. The view token is not an API key and expires automatically.

The P0 live view polls `/live-view/screenshot` for a current browser image. In read/write mode it forwards click and keyboard commands to `/live-view/command`. The embed posts `browser-kit-disconnected` to its parent window when the view token expires or the session becomes unavailable.

## Errors

All errors are JSON objects with an `error.code`, human-readable `error.message`, and a `retryable` flag. Clients should retry only errors marked retryable and should create a fresh session when the server returns `SESSION_EXPIRED`.

| Code | Meaning | Retryable |
| --- | --- | --- |
| `UNAUTHORIZED` | Missing or invalid API/view/control token. | No. |
| `FORBIDDEN` | The session policy or live-view mode denies the action. | No. |
| `NOT_FOUND` | Session or artifact does not exist. | No. |
| `INVALID_REQUEST` | Request or command shape is invalid. | No. |
| `SESSION_LIMIT` | Engine capacity is full. | Yes. |
| `SESSION_EXPIRED` | TTL elapsed. | No. |
| `STALE_OBSERVATION` | Element ref is no longer valid. | Refresh observation. |
| `ELEMENT_NOT_FOUND` | Locator did not resolve. | Usually no. |
| `ELEMENT_NOT_ACTIONABLE` | Locator exists but cannot be interacted with. | Sometimes. |
| `NAVIGATION_TIMEOUT` | Navigation exceeded its timeout. | Yes. |
| `ACTION_TIMEOUT` | Command exceeded its action timeout. | Yes. |
| `BROWSER_UNAVAILABLE` | Chromium could not be started or capacity is unavailable. | Yes. |
| `BROWSER_DISCONNECTED` | Browser or control channel disconnected. | Yes. |
| `POLICY_DENIED` | Network, evaluation, or origin policy blocked the command. | No. |
| `INTERNAL_ERROR` | Unexpected server-side error. | Usually yes. |
