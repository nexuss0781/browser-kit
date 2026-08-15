import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../dist/config.js";

test("loads Render-compatible defaults", () => {
  const previousPort = process.env.PORT;
  delete process.env.PORT;
  const config = loadConfig();
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 10000);
  assert.ok(config.maxSessions > 0);
  assert.ok(config.browserWarmIdleSeconds >= 0);
  if (previousPort === undefined) delete process.env.PORT;
  else process.env.PORT = previousPort;
});
