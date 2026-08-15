# Deployment Guide

## Client installation

The published client package is available on npm:

```bash
npm install browser-kit@0.1.0
```

The client only needs the public URL of the browser-kit engine and, for server-side calls, the engine API key:

```bash
BROWSER_KIT_URL=https://your-browser-kit-service.onrender.com
BROWSER_KIT_API_KEY=replace-with-a-long-random-secret
```

Never place `BROWSER_KIT_API_KEY` in a browser bundle. The frontend should receive only the short-lived `liveView.url` returned by a server-side call to `session.liveView()`.

## Local Docker

The Docker image contains Node.js, Chromium, the compiled engine, and the production dependencies:

```bash
cp .env.example .env
docker build -t browser-kit:local .
docker run --rm --env-file .env -p 10000:10000 browser-kit:local
```

The service binds to `0.0.0.0:$PORT`. The default local port is `10000`. Check readiness with:

```bash
curl http://localhost:10000/health/ready
```

## Render

The repository includes `render.yaml` and a Dockerfile for a Render web service.

1. Create a new Render Blueprint from the GitHub repository `nexuss0781/browser-kit`.
2. Set `BROWSER_KIT_API_KEY` as a secret environment variable.
3. Set `BROWSER_KIT_PUBLIC_URL` to the public HTTPS URL assigned to the service.
4. Keep `BROWSER_ALLOW_EVALUATE=false` unless a trusted server-side agent explicitly requires evaluation.
5. Start with `BROWSER_MAX_SESSIONS=1` or `2` and measure memory before increasing concurrency.
6. Use `/health/ready` as the service health check.

The service multiplexes REST, control WebSocket, live-view HTML, screenshot polling, and live-view commands over one public port. Render can replace instances during deploys or maintenance, so clients must reconnect and session state must not be treated as durable.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `10000` | Public HTTP/WebSocket port. |
| `BROWSER_KIT_API_KEY` | Recommended | unset | Bearer token for protected control-plane requests. |
| `BROWSER_KIT_PUBLIC_URL` | Recommended | `http://localhost:10000` | Base URL used when minting connection and view URLs. |
| `BROWSER_EXECUTABLE_PATH` | No | unset | Chromium executable path; Docker uses `/usr/bin/chromium`. |
| `BROWSER_MAX_SESSIONS` | No | `4` | Maximum concurrent in-memory sessions. |
| `BROWSER_DEFAULT_TTL_SECONDS` | No | `1800` | Maximum default session lifetime. |
| `BROWSER_DEFAULT_IDLE_TIMEOUT_SECONDS` | No | `300` | Default idle cleanup period. |
| `BROWSER_ALLOW_EVALUATE` | No | `false` | Global default for page JavaScript evaluation. |

## Scaling boundary

The P0 keeps active browser contexts and session records in process memory. Run one service instance for alpha usage. Before enabling multiple instances or high concurrency, add a durable session registry, worker leases, worker-affine routing, external artifact storage, and an explicit browser-profile strategy. A Render persistent disk may be used for temporary browser data, but it should not be the only source of truth for sessions or artifacts.
