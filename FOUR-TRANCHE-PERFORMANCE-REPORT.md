# Browser Kit Four-Tranche Performance Report

**Project:** `nexuss0781/browser-kit`  
**Engineering branch (historical):** `feat/performance-quality-engineering`
**Final performance commit:** [`892807d`](https://github.com/nexuss0781/browser-kit/commit/892807d)  
**SDK release (historical):** [`browser-kit@0.1.1`](https://www.npmjs.com/package/browser-kit/v/0.1.1)

## Executive summary

The Browser Kit performance program consisted of **four optimization tranches**. All four are now implemented, tested, visually validated, and pushed to GitHub. The work improved the system across three dimensions simultaneously: lower latency on critical workflows, stronger correctness and failure semantics, and more reliable behavior under artifacts, concurrency, security policies, and lifecycle stress.

The most important measured outcomes are the following. Asynchronous lease persistence reduced a matched 10-run workflow mean from **527.778 ms to 488.401 ms**, a **39.377 ms improvement**. Ordered command batching reduced a six-command workflow mean from **286.671 ms to 239.714 ms**, a **46.957 ms improvement**, or approximately **16.4%**. Warm-browser startup and Tranche 3 readiness improvements reduced another matched 10-run workflow mean from **592.506 ms to 538.413 ms**, a **54.093 ms improvement**. The final 30-run sequential production-scale benchmark completed with **30/30 successful workflows**, a mean of **269.401 ms**, p50 of **266.249 ms**, p95 of **296.097 ms**, and p99 of **401.950 ms**.

> **Overall conclusion:** Browser Kit now has a faster critical path with explicit bounded overload behavior, adaptive artifacts, stable observation references, warm-browser startup, durable artifact handling, truthful HTTP errors, and repeatable visual and security validation.

## Program scope and methodology

Every benchmark used a deterministic local Browser Kit Workbench fixture rather than an external website. This removed third-party network and anti-automation variability. The browser was real Chromium, not a mock. The workflow exercised navigation, form filling, keyboard submission, waiting, observation, clicking, hovering, contenteditable interaction, scrolling, reload, history navigation, screenshots, PDF generation, policy denial, artifact retrieval, and cleanup.

The audits used different sample sizes according to the tranche objective. Early optimization comparisons used five or ten repetitions to identify directional effects. The final production-scale validation used 30 sequential workflows and 10 concurrent workflows with four workers, and reported mean, p50, p95, p99, maximum, success count, and failure taxonomy.

The results should be interpreted as **matched engineering measurements**, not a universal promise for arbitrary websites. Browser navigation, Chromium startup, page complexity, screenshot dimensions, PDF size, host CPU, and concurrent load all influence absolute latency.

## Tranche overview

| Tranche | Primary objective | Main implementation | Status |
|---:|---|---|---|
| 1 | Remove persistence overhead from the critical path | Asynchronous, coalesced lease persistence | Complete |
| 2 | Reduce artifact blocking and HTTP round trips | Bounded artifact writers and ordered command batching | Complete |
| 3 | Reduce startup and stable-reference overhead | Warm-browser startup and observation-reference caching | Complete |
| 4 | Improve artifact efficiency and production resilience | Adaptive screenshots/PDFs and bounded command admission | Complete |

## Tranche 1: asynchronous and coalesced lease persistence

### Implementation achievements

Lease writes no longer block session creation or every browser activity event. Session and activity updates are scheduled in memory and coalesced over a 250 ms window. Close and lifecycle transitions still flush pending state before writing the final closed marker, preserving durability and diagnostic correctness.

The implementation added a pending lease map, coalescing timers, in-flight write tracking, atomic lease writes, and explicit flush behavior. Regression coverage verifies that ordinary activity uses scheduling while close flushes lifecycle state.

### Measured performance

The matched 10-run comparison was performed between the previous engineered implementation and the asynchronous lease implementation.

| Metric | Previous engineered | Tranche 1 | Change |
|---|---:|---:|---:|
| Successful workflows | 10/10 | 10/10 | Preserved |
| Mean workflow | 527.778 ms | **488.401 ms** | **−39.377 ms** |
| Median workflow | 490.396 ms | **487.010 ms** | −3.386 ms |
| p95 workflow | 514.448 ms | **500.490 ms** | −13.958 ms |
| Mean session creation | 112.419 ms | **82.591 ms** | **−29.828 ms** |
| Mean full-page screenshot | 101.967 ms | 101.977 ms | +0.010 ms |
| Mean PDF | 32.489 ms | 27.839 ms | −4.650 ms |

### Quality preservation

Artifact metadata and retrieval remained valid, screenshot bytes remained retrievable, repeated close remained idempotent, private-network policy remained active, and the visual artifact remained valid. No workflow failures occurred in the matched 10-run comparison.

## Tranche 2: bounded artifacts and ordered command batching

### Implementation achievements

Artifact persistence was moved to a bounded asynchronous writer queue with two concurrent writers and a default queue limit of 64. Pending artifacts remain available in memory while persistence completes. Durable writes use atomic replacement, and retrieval continues to return the correct MIME type and exact bytes.

The SDK gained `BrowserSession.executeBatch()`. The server gained `POST /v1/sessions/:id/commands/batch`. Batches accept 1–32 commands, execute them sequentially, return one result per command, stop on the first failure by default, and support explicit `continueOnError` behavior.

### Measured performance

The comparison used ten real Chromium workflows for six equivalent commands, comparing six separate HTTP requests against one batch request.

| Metric | Sequential commands | One batch request | Improvement |
|---|---:|---:|---:|
| Successful runs | 10/10 | 10/10 | Preserved |
| Mean full workflow | 286.671 ms | **239.714 ms** | **−46.957 ms / −16.4%** |
| Median full workflow | 249.537 ms | 247.772 ms | −1.765 ms |
| Mean command phase | 158.390 ms | **146.615 ms** | **−11.775 ms / −7.4%** |
| Artifact metadata | 10/10 | 10/10 | Preserved |
| Result count | 6/6 every run | 6/6 every run | Preserved |

### Failure and integrity behavior

Stop-on-error was tested with a three-command batch containing a policy-denied evaluation. It completed two commands and reported one failure. With `continueOnError: true`, it completed all three commands and still reported one failure. Artifact retrieval returned HTTP 200 and the retrieved byte count matched the inline payload byte count exactly.

## Tranche 3: observation cache and warm-browser startup

### Implementation achievements

Stable observation references are cached per session after `observe`. The cache is invalidated on navigation, reload, backward navigation, and forward navigation. A stale reference now returns HTTP 409 with `STALE_OBSERVATION` instead of falling through to a generic browser failure. Selector-based actions remain available and are not dependent on the cache.

The server gained the `BROWSER_WARM_START` configuration, enabled by default. Chromium is prelaunched during server startup and session creation reuses the warm browser promise. This separates browser process startup from the first session request.

### Measured performance

The matched 10-run comparison was made against the Tranche 2 server.

| Metric | Tranche 2 | Tranche 3 | Change |
|---|---:|---:|---:|
| Successful workflows | 10/10 | 10/10 | Preserved |
| Mean workflow | 592.506 ms | **538.413 ms** | **−54.093 ms** |
| Median workflow | 561.888 ms | **529.014 ms** | **−32.874 ms** |
| p95 workflow | 594.290 ms | **589.243 ms** | **−5.047 ms** |
| Mean session creation | 134.322 ms | **93.200 ms** | **−41.122 ms** |
| Mean observation | 38.581 ms | 38.799 ms | +0.218 ms |
| Mean click | 31.920 ms | 31.287 ms | −0.633 ms |

### Correctness behavior

The stale-reference smoke test confirmed HTTP 409 / `STALE_OBSERVATION`, fresh selector-based clicking returned HTTP 200, and session close remained successful. This is a quality improvement as well as a performance optimization because clients receive a precise recovery instruction: observe again.

## Tranche 4: adaptive artifacts and production-scale resilience

### Implementation achievements

Screenshots now support explicit format selection, quality, CSS/device scale, clipping, and adaptive defaults. Non-adaptive behavior remains backward compatible: PNG remains the default. Adaptive full-page captures can use JPEG, while clipped viewport captures can use WebP. PDF commands now support adaptive CSS page sizing and landscape options. The SDK exposes these parameters through `Page.screenshot()` and `Page.pdf()`.

Per-session command admission is bounded by `BROWSER_MAX_COMMAND_QUEUE`. Commands execute serially per session, and overload returns retryable HTTP 429 / `SESSION_LIMIT` rather than allowing unbounded queue growth. Artifact writer count and queue size are configurable through `BROWSER_ARTIFACT_WRITERS` and `BROWSER_ARTIFACT_QUEUE_LIMIT`.

### Adaptive artifact measurements

| Artifact | Result |
|---|---|
| Adaptive full-page JPEG | HTTP 200; 1440×1464; 43.9 KB; visually inspected |
| Adaptive clipped WebP | HTTP 200; 600×400; 10.8 KB; visually inspected |
| Adaptive PDF | HTTP 200; valid PDF; 32.9 KB |
| Artifact metadata | Present for all adaptive outputs |
| Artifact retrieval | Passed with byte-integrity checks |

The adaptive JPEG preserved the expected workbench header, search form, ready state, hover target, editable field, category control, and disabled control. The clipped WebP contained the expected top-left region at exactly 600×400.

### Production-scale load results

The final benchmark executed 30 sequential and 10 concurrent workflows using real Chromium and adaptive JPEG screenshots.

| Workload | Runs | Success | Mean | p50 | p95 | p99 | Maximum | Failure taxonomy |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Sequential | 30 | 30/30 | 269.401 ms | 266.249 ms | 296.097 ms | 401.950 ms | 401.950 ms | None |
| Concurrent, 4 workers | 10 | 10/10 | 639.360 ms | 685.006 ms | 739.085 ms | 739.085 ms | 739.085 ms | None |

### Queue saturation results

With `BROWSER_MAX_COMMAND_QUEUE=8`, a real concurrent test issued 40 commands against one session. The server returned **8 HTTP 200 responses and 32 HTTP 429 responses**, all with `SESSION_LIMIT`. This demonstrates bounded overload behavior and gives callers a clear retryable signal.

## Quality, security, and lifecycle achievements across the program

### Functional correctness

The final automated suite passed with **20 tests passed and 0 failures**. The tests cover SDK command execution, typed errors, batch payloads, adaptive SDK options, API authentication, lifecycle behavior, lease persistence, artifact queue configuration, warm-browser startup, observation cache invalidation, batch limits, and adaptive processing configuration.

### Visual validation

The deterministic visual workflow covered 19 actions and passed all expected checkpoints. The verifier confirmed a 1440×1464 full-page PNG, a 1440×900 viewport JPEG, expected result text, and a valid two-page PDF. The final adaptive JPEG and clipped WebP were also visually inspected as real files.

### Artifact integrity

Screenshot and PDF results include artifact identifiers, retrieval URLs, MIME types, byte counts, and expiration metadata. The artifact smoke test retrieved the generated PNG through the API and confirmed exact byte parity between inline data and durable retrieval.

### Security

Private-network navigation is blocked by default and returns HTTP 403 / `POLICY_DENIED`. Explicit `allowPrivateNetwork: true` remains available for deterministic local testing. JavaScript evaluation remains policy-gated and returns HTTP 403 when disabled. Live-view issuance authentication was corrected and returns HTTP 200 with a valid token under the authenticated control-plane path.

### Lifecycle and resilience

Connect and close operations are serialized. Close is idempotent. Deferred homepage navigation cannot race with the first user command. Lease records are coalesced during activity and flushed on close. Per-session command admission is bounded, and artifact persistence has bounded writer and queue capacity.

## Cumulative implementation inventory

| Capability | Final status |
|---|---|
| Explicit HTTP error mapping | Implemented |
| Typed SDK failure helper | Implemented |
| Ordered command batching | Implemented |
| Adaptive screenshot options | Implemented |
| Adaptive PDF options | Implemented |
| Stable observation-reference cache | Implemented |
| Warm-browser startup | Implemented |
| Asynchronous coalesced lease persistence | Implemented |
| Bounded artifact writer queue | Implemented |
| Bounded per-session command queue | Implemented |
| Durable artifact retrieval | Implemented |
| Visual regression workflow | Implemented |
| p50/p95/p99 production benchmark | Implemented |
| Private-network egress protection | Implemented |
| Historical SDK npm publication | `browser-kit@0.1.1` published |

## Final repository and release status

The historical Tranche 4 implementation is preserved in commit [`892807d`](https://github.com/nexuss0781/browser-kit/commit/892807d). The consolidated repository is now maintained on [`main`](https://github.com/nexuss0781/browser-kit/tree/main), with the current SDK release available as [`browser-kit@0.1.5`](https://www.npmjs.com/package/browser-kit/v/0.1.5).

The report’s evidence files include the production load JSON, adaptive artifact report, queue saturation smoke output, visual findings, and the engineering backlog. The metrics demonstrate that the four-tranche program is complete and that performance improvements were delivered without sacrificing visual correctness, artifact integrity, security policy, or lifecycle behavior.

## References

[1]: https://github.com/nexuss0781/browser-kit/tree/main "Browser Kit main branch"
[2]: https://github.com/nexuss0781/browser-kit/commit/892807d "Browser Kit Tranche 4 implementation commit"
[3]: https://www.npmjs.com/package/browser-kit "Browser Kit npm package"
[4]: https://github.com/nexuss0781/browser-kit/blob/main/ENGINEERING_BACKLOG.md "Browser Kit engineering backlog and benchmark record"
