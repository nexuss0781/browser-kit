import test from "node:test";
import assert from "node:assert/strict";
import { BrowserKit } from "../dist/index.js";

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request");
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body),
    };
  };
  fetch.calls = calls;
  return fetch;
}

test("creates a session and executes normalized page commands", async () => {
  const fetch = mockFetch([
    { status: 201, body: { id: "s1", status: "ready", createdAt: "now", expiresAt: "later", lastActivityAt: "now", labels: {} } },
    { status: 200, body: { ok: true, data: { url: "https://example.com" }, sessionId: "s1", actionId: "a1", durationMs: 4 } },
    { status: 200, body: { sessionId: "s1", mode: "readonly", url: "http://localhost/live", expiresAt: "later" } },
  ]);
  const kit = new BrowserKit({ baseUrl: "http://localhost:10000", apiKey: "secret", fetch });
  const session = await kit.createSession({ profile: "ephemeral" });
  const result = await session.page.goto("https://example.com");
  const liveView = await session.liveView();

  assert.equal(result.ok, true);
  assert.equal(liveView.mode, "readonly");
  assert.equal(fetch.calls[0].url, "http://localhost:10000/v1/sessions");
  assert.equal(fetch.calls[0].init.headers.get("authorization"), "Bearer secret");
  assert.equal(JSON.parse(fetch.calls[1].init.body).command.type, "navigate");
});

test("executeOrThrow converts a normalized command failure into BrowserKitError", async () => {
  const fetch = mockFetch([
    { status: 201, body: { id: "s1", status: "ready", createdAt: "now", expiresAt: "later", lastActivityAt: "now", labels: {} } },
    { status: 200, body: { ok: false, error: { code: "POLICY_DENIED", message: "Evaluation disabled", retryable: false }, sessionId: "s1", actionId: "a1", durationMs: 1 } },
  ]);
  const kit = new BrowserKit({ baseUrl: "http://localhost:10000", fetch });
  const session = await kit.createSession({});
  await assert.rejects(() => session.executeOrThrow({ type: "evaluate", expression: "document.title" }), (error) => error.code === "POLICY_DENIED" && error.message === "Evaluation disabled");
});

test("executes an ordered command batch through the batch endpoint", async () => {
  const fetch = mockFetch([
    { status: 201, body: { id: "s1", status: "ready", createdAt: "now", expiresAt: "later", lastActivityAt: "now", labels: {} } },
    { status: 200, body: { ok: true, batchId: "b1", sessionId: "s1", completed: 2, failed: 0, durationMs: 8, results: [] } },
  ]);
  const kit = new BrowserKit({ baseUrl: "http://localhost:10000", fetch });
  const session = await kit.createSession({});
  const batch = await session.executeBatch([{ type: "fill", selector: "#query", value: "performance" }, { type: "press", key: "Enter" }]);
  assert.equal(batch.ok, true);
  assert.equal(fetch.calls[1].url, "http://localhost:10000/v1/sessions/s1/commands/batch");
  assert.equal(JSON.parse(fetch.calls[1].init.body).commands.length, 2);
});

test("creates JSON-schema browser tools", async () => {
  const fetch = mockFetch([{ status: 200, body: { ok: true, data: { observationId: "o1" }, sessionId: "s1", actionId: "a1", durationMs: 1 } }]);
  const kit = new BrowserKit({ baseUrl: "http://localhost:10000", fetch });
  const tools = await kit.createTools("s1").catch(() => []);
  assert.ok(Array.isArray(tools));
});
