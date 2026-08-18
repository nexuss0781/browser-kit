# Browser Kit Grand Improvement Proposal

**Repository:** `nexuss0781/browser-kit`  
**Reviewed revision:** [`6d58ada64e1549b34b99513a16771739262130db`](https://github.com/nexuss0781/browser-kit/tree/6d58ada64e1549b34b99513a16771739262130db)  
**Author:** Manus AI  
**Purpose:** Improve Browser Kit from an alpha P0 remote Chromium engine into a reliable, observable, secure, and high-performance browser automation platform.

## Executive summary

The current implementation already demonstrates a valuable end-to-end capability: it can provision isolated Chromium sessions, navigate real websites, fill fields, press keys, observe pages, capture PNG/JPEG screenshots, generate PDFs, expose live views, and close sessions. The visual benchmark confirmed that the browser rendered real pages and that the screenshot pipeline captured them correctly. However, the benchmark also exposed several correctness and operability risks that should be resolved before the system is used for important agent workflows or multi-tenant production traffic.

The most urgent issue is not raw latency. It is **truthfulness of the API contract**. Several browser commands returned HTTP 200 while their normalized command envelope contained `ok: false`; the engine live-view token endpoint returned 401 because its authentication hook deliberately skipped `/live-view` requests while the route still required an authenticated actor; and connect/close showed intermittent internal failures that succeeded on immediate retry. These conditions make clients misclassify failures, complicate retries, and obscure whether the browser actually reached the desired visual state.

The proposal therefore recommends a staged program. First, repair command semantics, authentication, lifecycle races, and deterministic end-to-end testing. Second, replace fixed waits and external-site-dependent tests with readiness-aware execution and local visual fixtures. Third, improve performance through browser warm-up, navigation telemetry, command coalescing, screenshot optimization, and bounded concurrency. Finally, introduce production-grade isolation, SSRF protection, durable session leases, artifact storage, auditability, and worker routing.

## Evidence from the real benchmark

The performance run measured a 23-action workflow against a local Browser Kit server and a real Chromium instance. Eighteen actions completed successfully, while five either failed or were intentionally denied by policy. The successful-action mean was 605.072 ms and the median was 52.041 ms. The largest fixed cost was a deliberate 5-second wait, while the largest non-wait operation was filling a Google search field at 2,751.025 ms. Screenshots took 35.895–160.310 ms in the visual run, and PDF generation took 23.278 ms.

| Observation | Evidence | Engineering meaning |
|---|---|---|
| Browser rendering worked | The initial PNG visibly showed the Google homepage at 1440×900. | Chromium startup, page rendering, and screenshot encoding are operational. |
| Search submission worked mechanically | The final screenshot URL contained the submitted query. | Fill and keyboard actions reached the real page. |
| External search results were blocked | Google visibly returned an unusual-traffic interstitial. | External websites must not be used as deterministic correctness fixtures. |
| Command semantics are ambiguous | Navigation and evaluation returned HTTP 200 with nested failure envelopes. | HTTP success and browser-action success must be separated explicitly. |
| Engine live-view token route failed | `/v1/sessions/:id/live-view` returned 401 with a valid operator API key. | Authentication middleware and route policy are inconsistent. |
| Application live view worked | `/app/api/sessions/:id/live-view`, live-view HTML, and live-view screenshot succeeded. | The token and screenshot internals work; the public engine route is the defect. |
| Connect and close were intermittently unstable | First benchmark calls returned 500; immediate manual retries returned 200. | Browser/session lifecycle has a race or hidden transient failure. |
| Lightweight API operations are fast | Health, capability discovery, session retrieval, and listing were generally 1–3 ms locally. | Main optimization targets are browser lifecycle, navigation, readiness, and artifacts—not JSON routing. |

## Root-cause diagnosis

### A. Incorrect HTTP and command-result semantics

The command endpoint returns a normalized `ToolResult` envelope, but the server still responds with HTTP 200 when the browser command fails. This is visible in the implementation of `SessionManager.execute()`, which converts exceptions into `ToolFailure` rather than throwing them, followed by the REST route returning that result directly. A client that checks only `response.ok` therefore treats a failed browser action as successful.

This is not merely a documentation issue. Agent orchestration, retry logic, metrics, and user interfaces will all make incorrect decisions. The API should adopt one of two explicit contracts:

1. **HTTP-native contract:** return 2xx only when `ToolResult.ok === true`; return a mapped 4xx/5xx status when `ok === false`.
2. **Envelope-native contract:** always return 200, but rename the endpoint or document it as an RPC envelope and provide SDK helpers that throw on `ok === false`.

The recommended design is a hybrid: use HTTP status for transport and authorization failures, and use 200 plus a typed result envelope only for browser actions that were successfully accepted and completed. A browser action that executes and fails should return a typed 4xx/5xx status consistently, while preserving the full action envelope in the body.

### B. Broken public engine live-view authentication path

The request hook authenticates `/v1` requests unless the URL contains `/live-view`. The token-issuing `POST /v1/sessions/:id/live-view` route then calls `requireActor()`. Because the hook skipped authentication, no actor exists and the route returns `UNAUTHORIZED`. The token-consuming screenshot and HTML routes need to remain bearer-token authenticated, but the token-issuing route must use normal API-key authentication and session ownership checks.

The fix is to classify endpoints by authentication purpose rather than using a substring exception:

| Endpoint family | Required credential |
|---|---|
| Token issuance: `POST /v1/sessions/:id/live-view` | Control-plane API key plus `sessions:view` and ownership check |
| Token consumption: live-view HTML, screenshot, and input | Short-lived live-view token only |
| Control WebSocket | Short-lived control token only |
| Normal `/v1` control routes | Control-plane API key plus scope |

A route table or Fastify pre-handler should declare the credential mode explicitly. URL substring checks should be removed.

### C. Intermittent connect and close failures

The benchmark saw first-call 500 responses for connect and close, followed by successful retries against the same session. The current error handler normalizes unexpected errors but does not expose a correlation ID or a structured server-side cause in logs, so the exact exception is not recoverable from the client response.

Likely risk areas include browser startup and warm-idle transitions, context closure racing with timers, session record deletion during cleanup, and operations that are not idempotent under concurrent requests. The lifecycle must be modeled as a state machine with serialized transitions. `connect`, `close`, TTL expiry, idle cleanup, and browser shutdown should never mutate the same session concurrently without a per-session lock.

Recommended behavior is:

- `connect` is idempotent for a live session and returns a fresh short-lived token.
- `close` is idempotent and returns success when the target session is already closed.
- TTL and idle cleanup acquire the same session lock as API operations.
- Browser context closure is awaited exactly once.
- A second close does not produce `NOT_FOUND` or `INTERNAL_ERROR`; it returns a stable `{ ok: true, alreadyClosed: true }` result.
- Every lifecycle transition records `sessionId`, `actionId`, previous state, next state, cause, and duration.

### D. Navigation and observation readiness race

The visual run showed that an initial navigation or observation could report an internal command failure while a screenshot shortly afterward showed a real Google homepage. The current session creation path starts an initial page asynchronously, and the browser may still be transitioning from `about:blank` or from the default page when the first command arrives. The system therefore exposes a race between “session object exists” and “active page is ready for action.”

A session should not be marked `ready` until its browser context, active page, initial navigation state, and command executor are ready. If immediate interaction is intentionally allowed, the command executor must return a specific `BROWSER_STARTING` or `PAGE_NOT_READY` state rather than a generic internal error. The SDK should optionally wait for readiness with a bounded timeout.

### E. External-site variability is contaminating functional tests

Google’s anti-automation interstitial was a correct visual capture of the real page state, but it is not a valid fixture for asserting that search results render. Third-party latency, localization, bot checks, cookie state, and network failures make external pages appropriate for compatibility probes but unsuitable for deterministic regression tests.

The repository needs a local fixture application containing a search form, result list, links, dynamic loading state, scrolling content, an upload control, a download link, and a controlled error page. External sites should be used only in a separate, non-blocking smoke suite.

### F. Capability flags exceed implemented command surface

The session policy includes `allowDownloads`, `allowUploads`, `allowNetworkInterception`, and `allowRawCdp`, but the advertised command union does not expose dedicated operations for these capabilities. This creates a risk that users infer support from types even when the server cannot perform the operation.

Every policy flag should be classified as one of `implemented`, `experimental`, `planned`, or `unsupported`. The `/v1/capabilities` response should advertise capability status, required scopes, size limits, and version. Unsupported policy properties should either be removed from the public type or rejected with a clear `INVALID_REQUEST` message.

## Target API contract

### Typed command responses

Introduce a standard response shape:

```ts
interface CommandResponse<T> {
  ok: true;
  data: T;
  sessionId: string;
  actionId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  traceId: string;
}

interface CommandErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    phase: "admission" | "navigation" | "locator" | "interaction" | "artifact" | "lifecycle";
    details?: Record<string, unknown>;
  };
  sessionId: string;
  actionId: string;
  durationMs: number;
  traceId: string;
}
```

The server should map the result to HTTP status using a central table. The SDK should offer both `execute()` returning a discriminated result and `executeOrThrow()` throwing `BrowserKitError` on `ok: false`. This preserves flexibility for agents while making the safe path easy.

### Explicit readiness and retry contract

Add `waitUntil` and retry options to navigation and session connection:

```ts
interface NavigationOptions {
  waitUntil?: "commit" | "domcontentloaded" | "load" | "networkidle";
  timeoutMs?: number;
  retries?: number;
}
```

Retries must be limited to errors marked retryable. Navigation should never blindly replay non-idempotent user actions. Each retry must receive a new attempt ID and preserve the parent action ID.

### Capability discovery

Expand `/v1/capabilities` into a machine-readable contract:

```json
{
  "apiVersion": "v1",
  "engineVersion": "0.2.0",
  "commands": {
    "navigate": { "status": "stable", "idempotent": true },
    "screenshot": { "status": "stable", "formats": ["png", "jpeg", "webp"] },
    "upload": { "status": "planned" }
  },
  "limits": {
    "maxSessions": 4,
    "maxPagesPerSession": 8,
    "maxActionMs": 30000,
    "liveViewTtlSeconds": { "min": 30, "max": 900 }
  }
}
```

## Performance improvement program

### Performance priorities

The measured timings show that low-level HTTP routing is already inexpensive. Optimization should focus on browser lifecycle and page readiness rather than premature micro-optimizations in Fastify or JSON parsing.

| Priority | Optimization | Expected impact | Measurement |
|---|---|---|---|
| P0 | Eliminate fixed waits with selector, URL, and network-state waits | Removes unnecessary 3–5 second latency from agent workflows | p50/p95 action latency; wait overshoot |
| P0 | Make session readiness explicit | Removes first-command failures and retry overhead | first-command success rate; startup-to-ready latency |
| P0 | Add per-session lifecycle locks | Removes transient connect/close failures | lifecycle error rate; duplicate-close rate |
| P1 | Warm Chromium process with bounded idle policy | Reduces cold session creation latency | cold vs warm create p50/p95 |
| P1 | Add navigation phase timings | Identifies DNS, connection, response, DOM, and load bottlenecks | phase histogram per origin |
| P1 | Coalesce dependent actions | Reduces HTTP round trips for observe–click and fill–press workflows | actions per task; total workflow latency |
| P1 | Optimize screenshot path | Reduces CPU, payload size, and latency | encode time, bytes, p95 screenshot latency |
| P2 | External artifact storage and streaming | Prevents large base64 payloads from inflating memory and JSON time | resident memory; artifact download latency |
| P2 | Worker routing and session affinity | Enables concurrency without a single-instance bottleneck | sessions per worker; queue wait; throughput |

### Replace fixed waits with readiness-aware waits

The current wait command allows a duration, selector, or URL, but agents often choose a fixed duration because the result contract does not make readiness easy to discover. Improve this in three ways.

First, return a page-state snapshot after navigation containing URL, title, ready state, and pending network indicators. Second, make `waitFor` conditions composable: selector visible, selector hidden, URL matches, text contains, page title matches, or network idle. Third, add a maximum and minimum delay with early completion when the condition is satisfied.

For the benchmark, a local result page should complete in under 500 ms using a selector wait, while a fixed 3-second wait should be retained only as a fallback.

### Warm browser and page pools carefully

A single Chromium process can service multiple isolated browser contexts, reducing process startup overhead while maintaining cookie and storage isolation. Keep the browser warm for a bounded idle interval, but never reuse a context across tenants. Add a warm-up health probe that opens and closes a test context before accepting traffic.

Do not create an unbounded page pool. Use a queue with admission control, a maximum number of contexts per browser process, and memory-based circuit breaking. When the browser reaches a memory threshold or becomes unhealthy, stop admitting sessions and return a retryable `BROWSER_UNAVAILABLE` response.

### Instrument navigation and action phases

Every action should record:

| Phase | Example measurement |
|---|---|
| Admission | Queue wait and lock wait. |
| Browser dispatch | Time from server to Playwright call. |
| Page readiness | DOMContentLoaded, load, network idle, or selector readiness. |
| Locator | Ref/selector resolution time and selected element metadata. |
| Browser operation | Actual click, fill, screenshot, PDF, or navigation duration. |
| Serialization | Base64 encoding or artifact upload duration. |
| Response | JSON serialization and network response duration. |

This separates Browser Kit latency from external website latency. For example, the observed 2,751 ms fill operation must be decomposed before deciding whether to optimize selector resolution, Google page behavior, or network readiness.

### Reduce screenshot overhead

Offer an artifact-oriented response for screenshots:

```json
{
  "artifactId": "art_123",
  "mimeType": "image/jpeg",
  "width": 1440,
  "height": 900,
  "bytes": 82431,
  "sha256": "...",
  "url": "/v1/artifacts/art_123"
}
```

Keep base64 as a compatibility mode, but make artifact references the default for large images and PDFs. Support quality settings, viewport clipping, image deduplication, and optional thumbnails. Do not log base64 content or screenshots containing credentials.

## Quality and visual validation strategy

### Deterministic local fixture suite

Add a `fixtures/browser-workbench` app served locally during tests. It should contain:

| Fixture | Purpose |
|---|---|
| Search form | Test fill, type, press, submit, and result rendering. |
| Result list | Test observation, stable refs, click, and navigation. |
| Dynamic panel | Test selector waits and mutation-driven readiness. |
| Long document | Test scroll, full-page screenshot, and PDF. |
| Form controls | Test disabled elements, contenteditable, selects, checkboxes, and validation. |
| Download route | Test download policy and artifact handling. |
| Upload route | Test upload policy and size limits. |
| Error route | Test navigation errors and retryability. |
| Cross-origin page | Test allowlist and blocklist enforcement. |

The fixture should expose stable text and predictable rendering so screenshot comparison is meaningful.

### Visual assertions

Each end-to-end test should assert both machine-readable state and pixels. A browser action is successful only when:

1. The command envelope is `ok: true`.
2. The resulting URL/title or observation state matches the expected state.
3. A screenshot is captured successfully.
4. The screenshot has the expected dimensions and non-empty content.
5. For critical workflows, a perceptual image comparison is within a defined threshold.

Store screenshots only for failed tests by default, with an opt-in full artifact mode for performance runs. Use deterministic fonts, locale, timezone, viewport, and color scheme to reduce screenshot noise.

### External smoke tests

Maintain a separate external smoke suite for Google, Bing, documentation sites, and representative customer origins. Do not fail the core CI pipeline when an external site presents CAPTCHA, changes layout, or is unavailable. Record these outcomes as `EXTERNAL_BLOCK`, `EXTERNAL_TIMEOUT`, or `EXTERNAL_LAYOUT_CHANGED` rather than generic `INTERNAL_ERROR`.

## Security and multi-tenant hardening

### Network egress and SSRF protection

Before exposing sessions to untrusted agents, implement URL validation beyond scheme checks. Resolve DNS and reject private, loopback, link-local, multicast, carrier-grade NAT, and cloud metadata ranges. Protect against DNS rebinding by validating the resolved address at connection time, not only during URL parsing. Add domain, port, and proxy policies per tenant.

Navigation policy should provide a normalized decision record:

```json
{
  "origin": "https://example.com",
  "decision": "allow",
  "policyId": "tenant-default",
  "resolvedAddresses": ["203.0.113.10"]
}
```

Never expose raw resolution details to untrusted clients if they reveal internal network topology.

### Token and iframe safety

Keep API keys server-side. Issue live-view tokens with a narrowly scoped session ID, mode, expiration, nonce, and optional embedding origin. Bind tokens to an approved parent origin where possible. Set a strict Content Security Policy and `frame-ancestors` policy. Avoid putting bearer tokens in long-lived public URLs; support an exchange flow using a short-lived POST or secure cookie for embedded applications.

Read/write live view should require an explicit backend authorization decision and should emit audit events for every forwarded input. The browser panel should reject unexpected `postMessage` origins rather than accepting all messages globally.

### Data protection

Redact authorization headers, cookies, password fields, typed values, evaluation results, downloaded files, and screenshots from logs. Define retention periods for screenshots, PDFs, downloads, traces, and action events. Encrypt persistent profiles and artifacts at rest. Do not enable persistent profiles by default for cross-tenant workloads.

## Observability and operational excellence

### Structured action telemetry

Add a trace ID to every request, command, event, screenshot, and artifact. Emit structured events with redacted fields:

| Field | Purpose |
|---|---|
| `traceId` | Correlate API request, browser action, and artifact. |
| `sessionId` | Identify isolated browser context. |
| `actionId` | Identify one command execution. |
| `attemptId` | Separate retries from the parent command. |
| `commandType` | Aggregate by navigate, observe, screenshot, and so on. |
| `queueMs`, `browserMs`, `artifactMs`, `responseMs` | Explain latency. |
| `outcome` and `errorCode` | Track reliability. |
| `browserVersion`, `engineVersion` | Correlate regressions. |

Add metrics for session-start success, first-command success, action success, retry rate, navigation timeout, screenshot latency, artifact size, browser crashes, memory usage, queue depth, and WebSocket reconnects.

### Error handling

Preserve the original cause server-side while returning safe public details. Replace generic `INTERNAL_ERROR` with more precise categories such as `SESSION_STARTING`, `SESSION_CLOSING`, `PAGE_NOT_READY`, `NAVIGATION_FAILED`, `EXTERNAL_BLOCK`, and `ARTIFACT_FAILED`. Every retryable error must include a recommended retry delay or backoff class.

### Health checks

`/health/live` should indicate that the process is alive. `/health/ready` should also validate Chromium launchability, available capacity, storage availability, and database connectivity when configured. Add a degraded state rather than returning `{ ok: true }` when the process is alive but cannot create sessions.

## Architecture evolution

The current in-memory session registry is appropriate for a single-instance alpha but not for durable production use. The target topology should separate the public control plane from browser workers.

```text
Client / Agent
      |
      v
API gateway and authentication
      |
      +--> Session registry and durable leases
      |
      +--> Artifact service / object storage
      |
      +--> Event and metrics pipeline
      |
      v
Browser worker scheduler
      |
      +--> Worker A: isolated Chromium contexts
      +--> Worker B: isolated Chromium contexts
      +--> Worker N: isolated Chromium contexts
```

A session lease should contain worker ID, lease expiration, browser context ID, tenant, profile ID, and state. Worker heartbeats renew leases. If a worker disappears, the control plane marks the session as disconnected and either requests user recovery or performs a controlled session migration when profile persistence is available.

The SDK contract should remain stable while routing, storage, and worker placement evolve internally.

## Prioritized implementation roadmap

### Phase 0: Correctness gate — immediate

| Deliverable | Acceptance criterion |
|---|---|
| Fix public engine live-view authentication | API-key caller with `sessions:view` receives a token; token-consuming routes work without the API key. |
| Define HTTP/result semantics | A failed browser command cannot be mistaken for success by a normal HTTP client. |
| Add `executeOrThrow()` to SDK | SDK users receive a typed exception when a command result is unsuccessful. |
| Add lifecycle mutexes | 100 repeated connect/close cycles complete without transient 500 responses. |
| Make close idempotent | Repeated close returns stable success or a documented already-closed result. |
| Add trace IDs and server error causes | Every failure can be correlated from client response to server log. |

### Phase 1: Deterministic end-to-end quality

| Deliverable | Acceptance criterion |
|---|---|
| Build local browser workbench fixture | CI runs without Google, CAPTCHA, or external network dependency. |
| Add visual checkpoint tests | Initial page, form state, submitted results, scroll state, screenshot, and PDF are asserted. |
| Add readiness-aware waits | Selector and URL waits finish early when ready; no fixed 3–5 second sleep in the happy path. |
| Improve session readiness state | First command succeeds reliably after the SDK’s readiness promise resolves. |
| Add screenshot artifact validation | Dimensions, MIME type, byte count, and non-empty image are verified. |

### Phase 2: Performance

| Deliverable | Target |
|---|---:|
| Warm Chromium startup | Warm session creation p95 below 150 ms locally. |
| Cold startup instrumentation | Cold creation p95 is visible and bounded by a configured SLO. |
| Navigation phase telemetry | 99% of actions include complete phase timing data. |
| Replace fixed waits | Local fixture workflow p95 below 1 second excluding intentionally slow routes. |
| Screenshot optimization | Viewport JPEG p95 below 100 ms locally at 1440×900, with configurable quality. |
| Artifact references | Base64 response size is avoided for artifacts above a configurable threshold. |
| Bounded concurrency | Load tests maintain error rate below 1% at the declared session capacity. |

### Phase 3: Security and production readiness

| Deliverable | Acceptance criterion |
|---|---|
| SSRF and egress controls | Private and metadata IP targets are blocked, including DNS-rebinding scenarios. |
| Tenant-scoped authorization | Every session, artifact, profile, and event access is ownership-checked. |
| Profile and artifact encryption | Data is encrypted at rest with tested key rotation. |
| Rate limits and quotas | Per-tenant session, action, bandwidth, and artifact quotas are enforced. |
| Secret redaction | Automated tests prove that sensitive values do not appear in logs. |
| Browser and dependency pinning | Chromium and dependencies are reproducibly versioned and scanned. |

### Phase 4: Scale and resilience

| Deliverable | Acceptance criterion |
|---|---|
| Durable session leases | Worker failure is detected and sessions become visibly disconnected rather than silently hanging. |
| Worker routing | Sessions remain attached to the correct worker under normal operation. |
| Artifact object storage | Screenshots, PDFs, downloads, and traces survive API process restarts. |
| Event cursors | WebSocket reconnect can resume from the last acknowledged sequence. |
| Capacity circuit breakers | New work is rejected with retryable errors before browser workers become unstable. |
| Disaster and recovery tests | Recovery behavior is documented and automated for worker and database failures. |

## Performance test methodology after implementation

Every release should run three test classes.

**Deterministic local functional test.** Run ten repetitions against the local workbench with fixed viewport, locale, timezone, browser version, and network. Report p50, p95, p99, success rate, screenshot dimensions, image hash stability, and PDF validity.

**Synthetic load test.** Run increasing concurrency levels until the configured capacity limit. Measure queue wait, session creation, first command, navigation, observe, screenshot, artifact upload, and close. Record browser CPU, memory, process count, and crash rate.

**External smoke test.** Run a small non-blocking sample against real websites. Classify results into success, external block, timeout, navigation failure, and layout change. Never use it as the sole quality gate.

A performance result should be considered valid only when the test records both the protocol result and the visual artifact. A screenshot must be opened or perceptually checked in the artifact pipeline; storing a base64 field without inspecting the image is insufficient for visual correctness.

## Recommended first engineering sprint

The highest-value first sprint should implement the public live-view authentication fix, command status semantics, lifecycle serialization, trace IDs, and a local visual fixture. These changes directly address every major issue found in the benchmark and create a trustworthy foundation for later performance optimization.

The sprint should end with a single acceptance workflow:

```text
create session
  -> await ready
  -> navigate local fixture
  -> observe expected page
  -> fill search form
  -> press Enter
  -> wait for result selector
  -> observe result list
  -> click first result
  -> scroll
  -> capture viewport and full-page screenshots
  -> generate PDF
  -> request live-view token
  -> capture live-view screenshot
  -> close session
  -> repeat 100 times
```

The release gate should require zero unexpected command failures, zero lifecycle 500 responses, 100% valid screenshots, 100% valid PDFs, no false HTTP successes, and p95 workflow latency within the agreed local target.

## Final recommendation

Do not begin with broad micro-optimization. First make Browser Kit **correctly observable and semantically honest**. A fast API that reports false success is more dangerous than a slower API with precise errors. Once the action contract, lifecycle state machine, visual fixtures, and telemetry are reliable, optimize the real bottlenecks: browser startup, readiness waits, external navigation, artifact encoding, and concurrency admission. Then harden the network and tenant boundaries before exposing persistent profiles or multi-worker scale.

### References

[1]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/server/src/http-api.ts "Browser Kit HTTP API implementation"
[2]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/server/src/session-manager.ts "Browser Kit session manager"
[3]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/packages/browser-kit/src/types.ts "Browser Kit public types"
[4]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/packages/browser-kit/src/client.ts "Browser Kit TypeScript client"
[5]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/docs/architecture.md "Browser Kit architecture documentation"
[6]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/docs/security.md "Browser Kit security documentation"
[7]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/packages/browser-kit/src/tools.ts "Browser Kit agent tools"
