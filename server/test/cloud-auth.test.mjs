import assert from "node:assert/strict";
import test from "node:test";
import { CloudAuthService } from "../dist/cloud-auth.js";

class MemoryCloudDatabase {
  constructor() {
    this.users = new Map();
    this.webSessions = new Map();
    this.apiKeys = new Map();
    this.browserSessions = new Map();
    this.events = [];
  }
  async createUser(user) { const value = { ...user, createdAt: new Date(), disabledAt: null }; this.users.set(value.id, value); return value; }
  async findUserByEmail(email) { return [...this.users.values()].find((user) => user.email === email) ?? null; }
  async findUserById(id) { return this.users.get(id) ?? null; }
  async createWebSession(session) { const value = { ...session, createdAt: new Date(), lastSeenAt: new Date() }; this.webSessions.set(value.id, value); return value; }
  async findWebSession(tokenHash) { return [...this.webSessions.values()].find((session) => session.tokenHash === tokenHash && session.expiresAt > new Date()) ?? null; }
  async touchWebSession(id) { const session = this.webSessions.get(id); if (session) session.lastSeenAt = new Date(); }
  async deleteWebSession(id) { this.webSessions.delete(id); }
  async createApiKey(key) { const value = { ...key, createdAt: new Date(), lastUsedAt: null, revokedAt: null }; this.apiKeys.set(value.id, value); return value; }
  async listApiKeys(userId) { return [...this.apiKeys.values()].filter((key) => key.userId === userId); }
  async findApiKeyByPrefix(prefix) { return [...this.apiKeys.values()].find((key) => key.prefix === prefix) ?? null; }
  async touchApiKey(id) { const key = this.apiKeys.get(id); if (key) key.lastUsedAt = new Date(); }
  async revokeApiKey(userId, id) { const key = this.apiKeys.get(id); if (!key || key.userId !== userId || key.revokedAt) return false; key.revokedAt = new Date(); return true; }
  async claimBrowserSession(sessionId, userId) { this.browserSessions.set(sessionId, { userId, closed: false }); }
  async ownsBrowserSession(sessionId, userId) { const session = this.browserSessions.get(sessionId); return Boolean(session && session.userId === userId && !session.closed); }
  async listOwnedBrowserSessionIds(userId) { return [...this.browserSessions.entries()].filter(([, value]) => value.userId === userId && !value.closed).map(([id]) => id); }
  async closeBrowserSession(sessionId, userId) { const session = this.browserSessions.get(sessionId); if (session?.userId === userId) session.closed = true; }
  async audit(event) { this.events.push(event); }
}

function makeService() {
  const db = new MemoryCloudDatabase();
  const config = { apiKey: undefined, cloudAuthRequired: true, cloudSessionSecret: "session-secret-for-test", cloudKeyPepper: "key-pepper-for-test", cloudSessionTtlSeconds: 3600, publicUrl: "https://browser-kit.example" };
  return { db, service: new CloudAuthService(config, db) };
}

function reply() {
  return { headers: {}, header(name, value) { this.headers[name] = value; return this; } };
}

test("registers a normalized account and rejects duplicate or weak credentials", async () => {
  const { service, db } = makeService();
  const user = await service.register("  Agent@Example.com ", "a-long-enough-password");
  assert.equal(user.email, "agent@example.com");
  assert.match(user.passwordHash, /^scrypt\$/);
  assert.equal(db.events[0].action, "account.register");
  await assert.rejects(() => service.register("agent@example.com", "another-long-password"), /already exists/);
  await assert.rejects(() => service.register("not-an-email", "short"), /valid email/);
});

test("logs in with an HTTP-only signed session cookie and returns a generic failure", async () => {
  const { service, db } = makeService();
  const user = await service.register("agent@example.com", "a-long-enough-password");
  const result = reply();
  const loggedIn = await service.login("agent@example.com", "a-long-enough-password", result);
  assert.equal(loggedIn.id, user.id);
  assert.match(result.headers["set-cookie"], /^bk_cloud_session=bks_/);
  assert.match(result.headers["set-cookie"], /HttpOnly/);
  assert.match(result.headers["set-cookie"], /Secure/);
  const token = result.headers["set-cookie"].match(/^bk_cloud_session=([^;]+)/)[1];
  const identity = await service.getWebIdentity({ headers: { cookie: `theme=dark; bk_cloud_session=${token}` } });
  assert.equal(identity.user.id, user.id);
  await assert.rejects(() => service.login("agent@example.com", "wrong-password", reply()), /Invalid email or password/);
  await assert.rejects(() => service.login("missing@example.com", "wrong-password", reply()), /Invalid email or password/);
  assert.equal(db.webSessions.size, 1);
});

test("issues a plaintext key once while storing only its verifier, validates it, and enforces scopes", async () => {
  const { service, db } = makeService();
  const user = await service.register("agent@example.com", "a-long-enough-password");
  const issued = await service.issueApiKey(user, "Nexus agent", ["sessions:read"]);
  assert.match(issued.key, /^bk_live_[a-f0-9]{10}_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(issued.record.verifierHash, issued.key);
  assert.equal([...db.apiKeys.values()][0].verifierHash, issued.record.verifierHash);
  const actor = await service.authenticateApiKey(`Bearer ${issued.key}`);
  assert.equal(actor.kind, "user");
  assert.equal(actor.user.id, user.id);
  service.assertScope(actor, "sessions:read");
  assert.throws(() => service.assertScope(actor, "sessions:control"), /lacks sessions:control/);
  await assert.rejects(() => service.issueApiKey(user, "", ["sessions:read"]), /name is required/);
  await assert.rejects(() => service.issueApiKey(user, "no scopes", ["not:a:scope"]), /at least one/);
});

test("immediately rejects revoked or altered cloud API keys and protects browser-session ownership", async () => {
  const { service } = makeService();
  const owner = await service.register("owner@example.com", "a-long-enough-password");
  const other = await service.register("other@example.com", "another-long-password");
  const ownerKey = await service.issueApiKey(owner, "owner key", ["sessions:control", "sessions:close"]);
  const otherKey = await service.issueApiKey(other, "other key", ["sessions:read"]);
  const ownerActor = await service.authenticateApiKey(`Bearer ${ownerKey.key}`);
  const otherActor = await service.authenticateApiKey(`Bearer ${otherKey.key}`);
  await service.claimBrowserSession(ownerActor, "browser-session-1");
  await service.assertBrowserOwnership(ownerActor, "browser-session-1");
  await assert.rejects(() => service.assertBrowserOwnership(otherActor, "browser-session-1"), /not found/);
  await assert.rejects(() => service.authenticateApiKey(`Bearer ${ownerKey.key}x`), /invalid cloud API key/);
  await service.revokeApiKey(owner, ownerKey.record.id);
  await assert.rejects(() => service.authenticateApiKey(`Bearer ${ownerKey.key}`), /invalid cloud API key/);
});
