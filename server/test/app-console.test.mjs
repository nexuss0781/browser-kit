import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

const appHtml = await readFile(new URL("../ui/app.html", import.meta.url), "utf8");
const liveViewSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const httpApiSource = readFileSync(new URL("../src/http-api.ts", import.meta.url), "utf8");
const sessionManagerSource = readFileSync(new URL("../src/session-manager.ts", import.meta.url), "utf8");
const leaseStoreSource = readFileSync(new URL("../src/lease-store.ts", import.meta.url), "utf8");
const artifactStoreSource = readFileSync(new URL("../src/artifact-store.ts", import.meta.url), "utf8");

test("console converts unreachable fetch failures into a recoverable API state", () => {
  assert.match(appHtml, /Browser Kit API is unreachable\. Check the service endpoint and reload\./);
  assert.match(appHtml, /API unreachable — retrying/);
  assert.match(appHtml, /retryDelayMs/);
  assert.match(appHtml, /nextRetryAt/);
});

test("console does not leave action-log refresh failures unhandled", () => {
  assert.match(appHtml, /try\{await refreshLogs\(\)\}catch\(refreshError\)\{setApiUnavailable\(refreshError\)\}/);
  assert.match(appHtml, /void refreshLogs\(\)\.catch\(error=>setApiUnavailable\(error\)\)/);
});

test("console restores the active live view in the embedded browser panel", () => {
  assert.match(appHtml, /if\(state\.activeId&&!state\.viewUrl\)await loadView\(\)/);
  assert.doesNotMatch(appHtml, /id="open-view"/);
  assert.match(appHtml, /grid-template-columns:minmax\(0,1fr\) 400px/);
  assert.match(appHtml, /\[hidden\]\{display:none!important\}/);
});

test("console renders persistent browser tabs with safe tab controls", () => {
  assert.match(appHtml, /id='tab-strip'/);
  assert.match(appHtml, /data-tab-activate/);
  assert.match(appHtml, /data-tab-close/);
  assert.match(appHtml, /async function createTab\(\)/);
  assert.match(appHtml, /async function activateTab\(tabId\)/);
  assert.match(appHtml, /async function closeTab\(tabId\)/);
});

test("lease persistence is coalesced off the session creation path and flushed by close", () => {
  assert.match(sessionManagerSource, /leaseStore\.schedule\(\{/);
  assert.match(sessionManagerSource, /await this\.leaseStore\.remove\(id\)/);
  assert.match(leaseStoreSource, /coalesceMs/);
  assert.match(leaseStoreSource, /private readonly pending/);
});

test("batch commands and bounded artifact persistence remain explicit and guarded", () => {
  assert.ok(httpApiSource.includes("/v1/sessions/:id/commands/batch"));
  assert.match(httpApiSource, /commands\.length > 32/);
  assert.match(httpApiSource, /continueOnError/);
  assert.match(artifactStoreSource, /maxConcurrentWriters/);
  assert.match(artifactStoreSource, /maxQueueLength/);
  assert.match(httpApiSource, /artifactStore\.enqueue/);
});

test("engine live-view token issuance is authenticated separately from token consumption", () => {
  assert.match(httpApiSource, /isLiveViewTokenIssue/);
  assert.match(httpApiSource, /request\.method === "POST"/);
  assert.match(httpApiSource, /sendCommandResult\(reply, result, artifactStore\)/);
});

test("live view prioritizes a fast first frame and adaptive JPEG refresh cadence", () => {
  assert.match(liveViewSource, /Preparing first frame/);
  assert.match(liveViewSource, /frameCount < 3 \? 160 : 450/);
  assert.match(liveViewSource, /document\.hidden \? 2000/);
  assert.match(liveViewSource, /visibilitychange/);
});
