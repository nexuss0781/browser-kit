# Browser Kit Engineering Backlog

## Completed in this engineering phase

| Work item | Status | Verification |
|---|---|---|
| Authenticate engine live-view token issuance with the control-plane API key while keeping token-consuming live-view routes bearer-token-only | Done | Focused smoke test: token issuance returned 200. |
| Return explicit HTTP failure status for failed command envelopes | Done | Policy-denied evaluation returned HTTP 403 with `ok: false`. |
| Add `BrowserSession.executeOrThrow()` | Done | SDK regression test passes. |
| Serialize connect and close lifecycle operations | Done | Repeated close returned 200; lifecycle lock is compiled and tested. |
| Make close idempotent | Done | First and second close both returned 200. |
| Prevent deferred homepage navigation from racing with the first user command | Done | Local fixture navigation and observation both succeeded. |
| Add deterministic local visual workbench fixture | Done | Full-page PNG and viewport JPEG visibly showed successful search results. |
| Add regression assertions for the P0 route and SDK changes | Done | 14 automated tests pass across the two packages. |

## Next engineering phases

### Phase 1: Deterministic quality

Add stable fixture routes for clicks, hover, scroll, disabled controls, contenteditable fields, downloads, uploads, errors, and origin policy. Add visual assertions for screenshot dimensions, expected text, result-card presence, and PDF validity. Keep external websites in a separate non-blocking smoke suite.

### Phase 2: Observability

Add trace IDs, action-attempt IDs, lifecycle transition logs, redaction, and phase timing for admission, browser dispatch, page readiness, locator resolution, artifact encoding, and response serialization. Add metrics for first-command success, action success, retry rate, screenshot latency, artifact size, browser crashes, memory, queue depth, and WebSocket reconnects.

### Phase 3: Performance

Replace fixed waits with readiness conditions, expose navigation timing phases, add configurable screenshot quality and artifact references, warm Chromium with bounded idle controls, and introduce queue admission before browser capacity is exhausted. Establish local p50, p95, and p99 service-level objectives.

### Phase 4: Security and scale

Implement SSRF and DNS-rebinding protection, per-tenant egress rules, secure live-view origin binding, encrypted profiles and artifacts, quotas, durable session leases, external artifact storage, worker affinity, reconnect cursors, and capacity circuit breakers.

## Current local benchmark baseline

The deterministic local workflow completed 11 of 11 actions successfully. Mean latency was 34.368 ms, median 28.676 ms, p95 79.975 ms, maximum 86.188 ms, and total workflow time 378.051 ms. The screenshots and PDF were inspected as real artifacts.

## Completed in the second engineering milestone

| Work item | Status | Verification |
|---|---|---|
| Add deterministic local visual regression assertions | Done | 11 expected actions, screenshot dimensions, non-empty image content, result text, and PDF page count verified. |
| Add command phase timings | Done | Every browser command returned `admissionMs`, `browserMs`, and `totalMs`. |
| Expose `Server-Timing` headers | Done | 9 of 9 browser commands returned admission, browser, and total timing headers. |
| Preserve visual evidence | Done | Full-page PNG and viewport JPEG visually inspected after the instrumented run. |

## Second milestone benchmark

The instrumented local workflow completed 11 of 11 actions successfully. Current timings included session creation at 396.200 ms, local navigation at 90.750 ms, observation at 46.756 ms, fill at 17.916 ms, selector wait at 14.093 ms, full-page screenshot at 86.177 ms, viewport screenshot at 54.528 ms, PDF at 54.480 ms, and close at 13.240 ms. The timing payload and `Server-Timing` header agreed for every browser command.

The previous local run had a faster session-creation measurement at 79.975 ms; this difference is attributed to cold-process and browser startup variance. Screenshot performance was effectively unchanged, with full-page capture moving from 86.188 ms to 86.177 ms. Future comparisons should run multiple repetitions and report p50/p95/p99 rather than relying on one cold run.

## Completed in the expanded quality phase

The deterministic workflow now covers navigation, observation, fill, keyboard submission, selector waiting, stable-reference-compatible clicking, hover, contenteditable filling, scrolling, reload, back, forward, policy-denied evaluation, full-page screenshot, viewport screenshot, PDF generation, and idempotent close. The expanded run verified 19 expected actions, with all non-policy actions successful and evaluation correctly rejected with HTTP 403 / `POLICY_DENIED`. The visual verifier confirmed a 1440-pixel screenshot width, a full-page height greater than the viewport, a valid 1440x900 viewport JPEG, expected result text, and a valid two-page PDF.

## Completed in the performance, security, and resilience phases

The repeated load benchmark completed five sequential workflows and four two-worker concurrent workflows with zero failures. Sequential workflow mean was 255.461 ms, p50 249.970 ms, p95 265.744 ms, and maximum 268.974 ms. Two-worker concurrent mean was 387.229 ms, p50 387.750 ms, p95 396.383 ms, and maximum 399.951 ms.

Private-network navigation is now blocked by default with `POLICY_DENIED`. An explicit `allowPrivateNetwork: true` session policy is required to access local or private addresses. The security smoke test confirmed both behaviors.

Screenshot and PDF command results now produce durable artifact metadata and a retrieval URL. The artifact smoke test confirmed PNG MIME type, HTTP retrieval, and byte-for-byte parity with inline payload data. Session lease journals now record worker ID, lifecycle metadata, and closure markers under the configured lease root.

## Performance tranche 1: asynchronous coalesced lease persistence

Lease persistence no longer blocks session creation or every browser activity event. Updates are coalesced for 250 ms, while close flushes pending state before writing the closed marker. Regression assertions cover scheduled writes, coalescing state, and close flushing.

A 10-run matched comparison between the previous engineered server and the optimized server completed 10/10 workflows successfully on both sides. The previous engineered mean workflow was 527.778 ms; the optimized mean was 488.401 ms, a measured improvement of 39.377 ms. Median moved from 490.396 ms to 487.010 ms, and p95 moved from 514.448 ms to 500.490 ms. Session creation mean moved from 112.419 ms to 82.591 ms, a 29.828 ms improvement. Full-page screenshot remained effectively unchanged at 101.967 ms versus 101.977 ms.

The optimized server retained the correctness contract: live-view issuance returned 200, policy-denied evaluation returned 403, artifact metadata and retrieval remained valid, repeated close remained idempotent, private-network blocking remained active on the hardened server, and the final screenshot remained visually valid.

## Performance tranche 2: bounded artifacts and command batching

Artifact persistence now uses a bounded asynchronous writer queue with two concurrent writers, a maximum queue length of 64, in-memory retrieval during persistence, and atomic file replacement. Screenshot and PDF responses return artifact metadata immediately without waiting for filesystem persistence; retrieval remains byte-for-byte correct.

The SDK now exposes `BrowserSession.executeBatch()`. The server exposes `POST /v1/sessions/:id/commands/batch`, validates 1–32 commands, executes them sequentially in order, returns one result per command, supports stop-on-error by default, and supports explicit `continueOnError`.

Ten-run real Chromium comparison on the same server configuration produced:

| Mode | Mean full workflow | Median full workflow | Mean command phase | Successful |
|---|---:|---:|---:|---:|
| Six sequential HTTP commands | 286.671 ms | 249.537 ms | 158.390 ms | 10/10 |
| One ordered batch request | 239.714 ms | 247.772 ms | 146.615 ms | 10/10 |

The batch path reduced mean full-workflow time by 46.957 ms and mean command-phase time by 11.775 ms in this run. All batch runs returned six results and valid artifact metadata. Stop-on-error and `continueOnError` behavior were verified separately. The 19-action visual regression suite, screenshot dimensions, PDF validity, artifact byte integrity, security policy, live-view issuance, and idempotent close checks all passed.

## Performance tranche 3: observation cache and warm-browser startup

Stable observation refs are now cached per session and invalidated on navigation, reload, back, and forward. A ref used after invalidation returns `STALE_OBSERVATION` with HTTP 409 rather than falling through to a generic browser error. Selector-based actions remain available and are unaffected by the ref cache.

The server now supports `BROWSER_WARM_START`, enabled by default, which prelaunches Chromium during server startup. Session creation reuses the warm browser promise. A 10-run real Chromium comparison against the tranche-two server produced:

| Metric | Tranche 2 | Tranche 3 | Change |
|---|---:|---:|---:|
| Workflow mean | 592.506 ms | 538.413 ms | -54.093 ms |
| Workflow median | 561.888 ms | 529.014 ms | -32.874 ms |
| Workflow p95 | 594.290 ms | 589.243 ms | -5.047 ms |
| Session creation mean | 134.322 ms | 93.200 ms | -41.122 ms |
| Observe mean | 38.581 ms | 38.799 ms | +0.218 ms |
| Click mean | 31.920 ms | 31.287 ms | -0.633 ms |
| Successful workflows | 10/10 | 10/10 | Preserved |

The Tranche 3 smoke test verified stale refs return HTTP 409 / `STALE_OBSERVATION`, fresh selector actions still succeed, and close remains idempotent. The expanded 19-action visual workflow passed with a valid 1440x1464 PNG, 1440x900 JPEG, expected result text, and valid two-page PDF. Artifact byte integrity and production-safe private-network blocking also passed. The full automated suite passed with 18 tests and 0 failures.

## Performance tranche 4: adaptive artifacts and production-scale resilience

Adaptive screenshot options now support explicit format, quality, CSS/device scale, clipping, and adaptive defaults. Adaptive full-page screenshots default to JPEG while viewport captures default to WebP; existing non-adaptive PNG behavior remains unchanged. PDF commands support adaptive CSS page sizing and landscape options. The SDK exposes the same options through `Page.screenshot()` and `Page.pdf()`.

Session command admission is now bounded by `BROWSER_MAX_COMMAND_QUEUE`. Commands execute serially per session, and overload returns retryable HTTP 429 / `SESSION_LIMIT` instead of allowing unbounded command contention. Artifact writer count and queue length are configurable through `BROWSER_ARTIFACT_WRITERS` and `BROWSER_ARTIFACT_QUEUE_LIMIT`.

A production-scale real Chromium benchmark ran 30 sequential and 10 concurrent workflows with adaptive JPEG screenshots:

| Workload | Runs | Success | Mean | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|
| Sequential | 30 | 30/30 | 269.401 ms | 266.249 ms | 296.097 ms | 401.950 ms | 401.950 ms |
| Concurrent, 4 workers | 10 | 10/10 | 639.360 ms | 685.006 ms | 739.085 ms | 739.085 ms | 739.085 ms |

A bounded queue smoke test with an eight-command limit produced 8 successful commands and 32 explicit HTTP 429 / `SESSION_LIMIT` responses under 40 concurrent requests. Adaptive JPEG, clipped WebP, and adaptive PDF artifacts all returned HTTP 200 with artifact metadata. The adaptive JPEG and clipped WebP were visually inspected and preserved the expected workbench content. The standard 19-action visual suite, artifact byte-integrity test, production-safe private-network test, lifecycle close test, and full 20-test suite all passed.
