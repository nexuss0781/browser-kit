# Security Guide

## Trust boundaries

The engine API key authenticates server-side control-plane calls. It must remain in the Nexus backend or another trusted server. The embedded browser panel receives only a short-lived token scoped to one session and one live-view mode.

The P0 has three distinct capabilities:

| Capability | Credential | Intended holder |
| --- | --- | --- |
| Control-plane REST | `BROWSER_KIT_API_KEY` | Trusted backend. |
| Agent WebSocket control | Short-lived session control token | One agent/session connection. |
| Embedded live view | Short-lived read-only or read/write view token | User-facing browser panel. |

## Browser isolation

Every created session receives a separate Chromium `BrowserContext`. Sessions have independent cookies, local storage, service workers, pages, TTL timers, and idle cleanup. Do not reuse a persistent profile between tenants without an explicit encrypted-profile design and access policy.

## Navigation and script policy

Only `http` and `https` navigation is accepted. Use `allowedOrigins` for a strict tenant or task allowlist and `blockedOrigins` for known-deny rules. JavaScript evaluation is disabled by default and should remain disabled for untrusted agents. If evaluation is enabled, use a server-side policy and action audit trail.

The current P0 does not yet provide a complete outbound egress firewall. Before exposing it to untrusted tenants, add SSRF protection, private-network and metadata-IP blocking, DNS rebinding protection, domain and port policies, and a documented proxy strategy.

## Live-view safety

Use `readonly` mode unless the user must interact with the browser. Use `readwrite` mode only after the backend has established that the user is authorized to control the session. Treat view URLs as bearer credentials: do not log them, place them in analytics events, or persist them in public URLs longer than necessary.

The panel should be embedded only on approved application origins. The P0 live-view response is designed for an iframe and sends a disconnect message to the parent window when the session or token becomes unavailable. The parent application must remove the panel and request a new token instead of retrying an expired URL indefinitely.

## Sensitive data

Avoid logging cookies, authorization headers, passwords, form values, downloaded documents, screenshots containing credentials, or evaluation results containing secrets. The P0 keeps the API key out of the frontend, but application-level redaction and artifact retention policies are still required for production.

## Operational controls

Set conservative session TTL, idle timeout, maximum concurrent sessions, maximum page count, action timeout, upload size, download size, and artifact retention. Monitor browser crashes, memory usage, session startup latency, WebSocket reconnects, screenshot bandwidth, and failed navigation. Terminate abandoned sessions and reap temporary browser directories.

## Production checklist

Before production launch, implement tenant authorization on every endpoint, origin allowlists for live-view embedding, durable audit events, encrypted persistent profiles, external artifact storage, network egress controls, rate limits, secret redaction, dependency and Chromium pinning, vulnerability scanning, and incident-response procedures. The alpha in-memory session registry is not durable across Render instance replacement.
