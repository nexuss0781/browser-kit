# Changelog

## 0.1.0 — 2026-08-15

### Added

- TypeScript SDK for remote Chromium session creation, commands, page observation, locators, keyboard actions, screenshots, PDFs, live-view tokens, and reconnect-aware control.
- Nexus JSON-schema browser tools for observation, navigation, click, fill, type, keyboard, scroll, screenshots, and waits.
- Optional `browser-kit/react` `BrowserPanel` component.
- Docker and Render deployment configuration for the remote browser engine.
- HTTP, WebSocket, live-view, architecture, deployment, security, and roadmap documentation.

### Notes

- The P0 live view uses screenshot polling with HTTP input forwarding rather than WebRTC/TURN.
- Active sessions are held in process memory and are not durable across Render instance replacement.
- Durable profiles, external artifacts, multi-worker routing, strict egress controls, and raw CDP proxying remain planned milestones.
