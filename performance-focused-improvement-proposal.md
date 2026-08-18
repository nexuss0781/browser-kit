# Browser Kit Performance-Focused Improvement Proposal

**Objective:** Reduce Browser Kit latency and improve throughput while preserving the correctness, security, visual fidelity, artifact integrity, and end-to-end reliability already achieved.

**Evidence base:** Fresh five-run before/after audit using identical Chromium settings, deterministic fixture, viewport, action sequence, and separate servers. The original revision was commit `6d58ada`; the after version was the engineered working tree.

## Executive recommendation

The current after version is approximately 18.659 ms slower per complete workflow on average than the original baseline: 635.297 ms versus 616.638 ms. This is a small approximately 3% cost, concentrated primarily in session creation, and it buys materially better behavior: working engine live-view issuance, explicit HTTP failure semantics, serialized lifecycle operations, private-network protection, durable artifact metadata, lease journals, and phase-level timing.

The goal should not be to remove these protections. The goal should be to **move non-critical persistence and metadata work off the critical browser path, reduce duplicate browser and file operations, and preserve every quality gate around the optimized path**.

The first target is session creation, where the after version is 20.535 ms slower on average. The second target is the complete workflow, where the after mean is 635.297 ms and p95 is 600.056 ms in the five-run audit. Browser operations themselves are already close to baseline: observe, fill, screenshots, PDF, history, and click are within a few milliseconds of the original implementation.

## Baseline and budgets

| Metric | Current before | Current after | Performance target |
|---|---:|---:|---:|
| Session creation mean | 141.784 ms | 162.319 ms | ≤145 ms warm; ≤220 ms cold |
| Navigation mean | 42.888 ms | 31.729 ms | ≤40 ms local fixture |
| Observe mean | 40.068 ms | 40.303 ms | ≤40 ms local fixture |
| Fill mean | 12.279 ms | 12.377 ms | ≤15 ms |
| Click mean | 42.937 ms | 38.527 ms | ≤45 ms |
| Full-page screenshot mean | 108.262 ms | 110.053 ms | ≤110 ms at 1440px width |
| Viewport screenshot mean | 38.497 ms | 38.639 ms | ≤45 ms |
| PDF mean | 32.260 ms | 33.163 ms | ≤40 ms |
| Close mean | 10.019 ms | 10.717 ms | ≤15 ms |
| Complete workflow mean | 616.638 ms | 635.297 ms | ≤600 ms warm |
| Complete workflow p95 | 576.785 ms | 600.056 ms | ≤650 ms |

The budgets should be evaluated across at least 30 repetitions for release decisions. The current five-run audit is a useful directional comparison but is not sufficient for stable p99 conclusions.

## Performance principles

> **Quality must be invariant across optimization paths.** Every optimization is acceptable only if command success semantics, security policy, screenshot dimensions, artifact byte integrity, lease correctness, and end-to-end visual assertions remain unchanged.

The optimized system should preserve these invariants:

| Invariant | Required behavior |
|---|---|
| Command truthfulness | Failed commands remain distinguishable from successful commands through both HTTP status and the result envelope. |
| Security | Private-network blocking, origin policies, evaluation policy, token scope, and ownership checks remain active on every path. |
| Visual correctness | The same deterministic fixture produces the same expected page state and acceptable screenshot comparison. |
| Artifact integrity | Artifact URL, MIME type, byte count, and content hash remain valid after optimization. |
| Lifecycle correctness | Connect and close remain serialized and idempotent; TTL and idle cleanup cannot race with user commands. |
| Observability | `admissionMs`, `browserMs`, `totalMs`, trace IDs, and outcome codes remain available. |
| Compatibility | Existing SDK `execute()` behavior remains available; `executeOrThrow()` remains correct. |

## Phase P1: Remove session-creation critical-path overhead

### 1. Make lease persistence asynchronous after readiness

The current session creation path awaits a lease-file write before returning the session summary. That write is the clearest explanation for the approximately 20.535 ms session-creation regression. Change the behavior so that the session is inserted into the in-memory registry and becomes usable immediately, while the lease write is scheduled on a bounded persistence queue.

The lease state machine should be:

```text
create browser context
      |
      v
register ready session in memory
      |
      +--> return session summary immediately
      |
      +--> enqueue lease persistence
```

The queue must not silently lose failures. If persistence fails, expose a `leasePersistenceLag` metric and emit a structured error event, but do not invalidate an already-usable browser session. At shutdown, drain the queue with a bounded timeout.

**Acceptance criteria:** warm session-creation mean returns to ≤145 ms; no session is returned before its in-memory state is usable; lease persistence eventually produces a correct record; simulated persistence failure does not create a false browser failure.

### 2. Batch lease updates

The current `touch()` operation writes a lease on every activity and navigation event. Replace per-event file writes with a coalescing scheduler. A session may update its lease in memory on every activity, but persistence should occur at most once every 250–500 ms per session or immediately for major lifecycle transitions such as create, close, and expiry.

This reduces filesystem churn and prevents a burst of browser events from creating a burst of JSON rewrites.

**Acceptance criteria:** a 100-action workflow produces no more than a bounded number of lease writes; the final persisted `lastActivityAt` is within the configured flush interval; close always flushes a final closed marker.

### 3. Avoid synchronous artifact work during ordinary commands

Artifact persistence should remain on the screenshot/PDF path but should not add unnecessary work to session creation or non-artifact actions. Use a dedicated artifact queue with bounded concurrency. For small artifacts, an in-process write is acceptable; for larger artifacts, stream directly to a temporary file and atomically rename it.

The command response may return the artifact metadata after the write completes, but the artifact path must not block unrelated sessions. Use a per-artifact timeout and a retryable `ARTIFACT_FAILED` error.

## Phase P2: Optimize command and browser paths

### 1. Add a readiness-aware command admission path

The current first-command race has been fixed through cancellation and synchronization. Preserve that correctness, but make the state explicit. Add a readiness promise to the session record and expose a small admission status:

```ts
interface ReadinessState {
  browserReady: boolean;
  pageReady: boolean;
  initialNavigationPending: boolean;
}
```

Commands that do not depend on page navigation, such as `screenshot` of the ready card or `close`, should proceed immediately. Commands that require a page should await the readiness promise with a bounded timeout. This avoids making every command pay the same synchronization cost.

### 2. Reuse locators and observation metadata safely

Observation currently evaluates the page and then action commands resolve a selector or stable ref again. For stable refs, cache the observation ID and element ref mapping in the session record. Validate that the current observation is still active before using the cached mapping. If the DOM changed, return `STALE_OBSERVATION` and ask the client to refresh rather than paying repeated failed locator retries.

Do not cache arbitrary CSS selectors or bypass Playwright’s actionability checks. The optimization is limited to stable references generated by Browser Kit.

### 3. Introduce safe command batching

Many agent workflows use a predictable sequence such as observe → fill → press → wait → screenshot. Add an optional `executeBatch` endpoint and SDK method for **idempotent or explicitly ordered commands**. The server should return one result per command and stop at the first failure unless `continueOnError` is explicitly requested.

Batching reduces HTTP round trips without weakening result semantics:

```json
{
  "commands": [
    { "type": "fill", "selector": "#query", "value": "performance" },
    { "type": "press", "key": "Enter" },
    { "type": "wait", "selector": "[data-result] article" }
  ]
}
```

Every individual command retains its own action ID, timing breakdown, and error. The batch receives a parent trace ID.

**Acceptance criteria:** the batched fixture workflow is at least 15% faster than three sequential HTTP requests; individual command results remain identical; a failed middle command cannot be misreported as a successful batch.

### 4. Use adaptive screenshot encoding

Keep PNG for visual regression and pixel-sensitive workflows. Use JPEG or WebP for live view and large photographic pages. Add explicit quality and maximum-byte options. Before returning an image, record capture, encoding, persistence, and response timings separately.

For full-page screenshots, add a `clip` or `scale` option so agents do not capture the entire document when only a result region is needed. This should reduce screenshot CPU time and artifact size without changing default behavior.

### 5. Make PDF output explicitly asynchronous for large pages

For small pages, keep the current synchronous command behavior. For documents above a configured height or byte estimate, return an artifact job with a short polling URL. This protects browser workers from holding an HTTP request open during large PDF generation.

The job must preserve session ownership, artifact authorization, expiration, and error semantics.

## Phase P3: Improve concurrency without reducing isolation

The existing two-worker benchmark completed four concurrent workflows successfully, with mean workflow latency of 387.229 ms and p95 of 396.383 ms. The next step is not uncontrolled concurrency. It is bounded admission and better scheduling.

Add a session admission queue with a declared maximum. When capacity is available, a request enters a worker immediately. When capacity is full, return a retryable `SESSION_LIMIT` response with a `retry-after` hint rather than allowing browser memory pressure to degrade all sessions.

Use separate limits for:

| Resource | Limit |
|---|---:|
| Concurrent sessions | Configured capacity |
| Pages per session | Policy limit |
| Concurrent browser commands per session | 1 by default |
| Concurrent artifact encoders | Configured worker pool |
| Lease persistence writes | Coalesced per session |
| Artifact bytes per tenant | Quota |

A single session should not execute two mutating browser commands concurrently. Read-only capture may be allowed concurrently only after testing shows that screenshots cannot observe an inconsistent page state.

## Phase P4: Quality-preserving performance harness

### Matched audit protocol

Every performance change should run the same before/after protocol:

1. Build both versions from explicitly recorded revisions.
2. Start separate servers with identical Chromium path, viewport, locale, timezone, memory limits, and fixture server.
3. Warm the browser with two discarded runs.
4. Execute at least 30 sequential workflows.
5. Execute at least 10 two-worker concurrent workflows.
6. Capture one full-page PNG, one viewport JPEG, and one PDF per version.
7. Verify screenshot dimensions and non-empty content.
8. Verify expected result text and URL state.
9. Verify artifact retrieval and byte integrity.
10. Verify policy-denied evaluation returns 403 and private-network navigation is blocked when configured.
11. Report mean, p50, p95, p99, success rate, and error taxonomy.

### Quality gates

An optimization may ship only when all conditions hold:

| Gate | Threshold |
|---|---:|
| Functional workflow success | 100% in deterministic fixture suite |
| Visual assertion success | 100% expected checkpoints |
| Screenshot dimension correctness | 100% |
| PDF validity | 100% |
| Artifact byte integrity | 100% |
| Security policy regressions | 0 |
| Lifecycle failures | 0 unexpected 5xx responses in 100 close/connect cycles |
| Sequential p95 regression | No more than 5% unless explicitly approved |
| Concurrent error rate | Below 1% at declared capacity |
| Lease persistence loss | 0 final lifecycle records lost |

## Recommended implementation order

| Order | Change | Why first |
|---:|---|---|
| 1 | Asynchronous lease persistence with coalescing | Directly targets the measured session-creation regression. |
| 2 | Warm-up plus 30-run audit harness | Prevents optimizing against cold-start noise. |
| 3 | Artifact queue and atomic streaming writes | Preserves durability while reducing blocking and memory pressure. |
| 4 | Stable-ref observation cache | Reduces repeated DOM/locator work without bypassing safety. |
| 5 | Command batching | Reduces network round trips and improves agent workflow latency. |
| 6 | Adaptive screenshot and PDF paths | Targets artifact-heavy workflows without changing quality defaults. |
| 7 | Bounded admission and per-session command serialization | Improves concurrency predictability and protects isolation. |

## Expected outcome

The realistic first target is to reduce the after version from 635.297 ms mean workflow latency to approximately 600 ms or below while reducing warm session creation from 162.319 ms toward the 140–145 ms range. The exact result should be measured rather than assumed.

The largest risk is over-optimizing persistence and batching in a way that hides failures. The design must therefore keep persistence state, command envelopes, security policy, artifact metadata, and visual assertions explicit. Performance is successful only when the faster system is equally truthful and equally verifiable.

## References

[1]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/server/src/session-manager.ts "Original Browser Kit session manager"
[2]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/server/src/http-api.ts "Original Browser Kit HTTP API"
[3]: https://github.com/nexuss0781/browser-kit/blob/6d58ada64e1549b34b99513a16771739262130db/docs/security.md "Browser Kit security guide"
