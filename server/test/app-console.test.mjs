import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appHtml = await readFile(new URL("../ui/app.html", import.meta.url), "utf8");

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

