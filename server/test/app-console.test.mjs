import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appHtml = await readFile(new URL("../ui/app.html", import.meta.url), "utf8");
const liveViewSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

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

test("live view prioritizes a fast first frame and adaptive JPEG refresh cadence", () => {
  assert.match(liveViewSource, /Preparing first frame/);
  assert.match(liveViewSource, /frameCount < 3 \? 160 : 450/);
  assert.match(liveViewSource, /document\.hidden \? 2000/);
  assert.match(liveViewSource, /visibilitychange/);
});
