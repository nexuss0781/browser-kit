import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { BrowserKitError, errorCodes } from "browser-kit";
import type { ServerConfig } from "./config.js";
import { CloudDatabase, type CloudApiKey, type CloudUser } from "./cloud-db.js";

const cookieName = "bk_cloud_session";
const allowedScopes = ["sessions:read", "sessions:control", "sessions:view", "sessions:close"] as const;
export type CloudScope = (typeof allowedScopes)[number];
export type CloudActor = { kind: "operator" } | { kind: "user"; user: CloudUser; apiKey: CloudApiKey };
export type CloudWebIdentity = { user: CloudUser; sessionId: string };

function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
function hashText(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const [key, value] = part.trim().split(/=(.*)/s, 2);
    if (key && value !== undefined) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function derivePasswordKey(password: string, salt: string, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, length, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived)));
}

export class CloudAuthService {
  readonly enabled: boolean;
  readonly required: boolean;
  readonly db: CloudDatabase | undefined;
  private readonly config: ServerConfig;

  constructor(config: ServerConfig, db?: CloudDatabase) {
    this.config = config;
    this.db = db;
    this.enabled = Boolean(db);
    this.required = config.cloudAuthRequired;
    if (this.required && (!db || !config.cloudSessionSecret)) throw new Error("CLOUD_AUTH_REQUIRED requires DATABASE_URL and CLOUD_SESSION_SECRET");
  }

  private sessionHash(token: string): string { return createHmac("sha256", this.config.cloudSessionSecret ?? "browser-kit-local-session").update(token).digest("hex"); }
  private keyHash(rawKey: string): string { return createHmac("sha256", this.config.cloudKeyPepper ?? this.config.cloudSessionSecret ?? "browser-kit-local-key").update(rawKey).digest("hex"); }
  private async passwordHash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const digest = await derivePasswordKey(password, salt, 64);
    return `scrypt$${salt}$${digest.toString("base64url")}`;
  }
  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [algorithm, salt, encoded] = stored.split("$");
    if (algorithm !== "scrypt" || !salt || !encoded) return false;
    const expected = Buffer.from(encoded, "base64url");
    const actual = await derivePasswordKey(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  private secureCookie(reply: FastifyReply, rawToken: string, expiresAt: Date): void {
    const secure = this.config.publicUrl.startsWith("https://");
    reply.header("set-cookie", `${cookieName}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}${secure ? "; Secure" : ""}`);
  }

  async register(emailInput: string, password: string): Promise<CloudUser> {
    if (!this.db) throw new BrowserKitError(errorCodes.internal, "Cloud account storage is not configured", { status: 503 });
    const email = normalizeEmail(emailInput);
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || password.length > 256) throw new BrowserKitError(errorCodes.invalidRequest, "Use a valid email and a password of at least 12 characters", { status: 400 });
    if (await this.db.findUserByEmail(email)) throw new BrowserKitError(errorCodes.invalidRequest, "An account already exists for this email", { status: 409 });
    const user = await this.db.createUser({ id: randomUUID(), email, passwordHash: await this.passwordHash(password) });
    await this.db.audit({ id: randomUUID(), userId: user.id, action: "account.register", targetType: "user", targetId: user.id, outcome: "success", detail: {} });
    return user;
  }

  async login(emailInput: string, password: string, reply: FastifyReply): Promise<CloudUser> {
    if (!this.db) throw new BrowserKitError(errorCodes.internal, "Cloud account storage is not configured", { status: 503 });
    const user = await this.db.findUserByEmail(normalizeEmail(emailInput));
    if (!user || user.disabledAt || !(await this.verifyPassword(password, user.passwordHash))) throw new BrowserKitError(errorCodes.unauthorized, "Invalid email or password", { status: 401 });
    const rawToken = `bks_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + this.config.cloudSessionTtlSeconds * 1000);
    const session = await this.db.createWebSession({ id: randomUUID(), userId: user.id, tokenHash: this.sessionHash(rawToken), expiresAt });
    this.secureCookie(reply, rawToken, session.expiresAt);
    await this.db.audit({ id: randomUUID(), userId: user.id, action: "account.login", targetType: "web_session", targetId: session.id, outcome: "success", detail: {} });
    return user;
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const identity = await this.getWebIdentity(request);
    if (identity && this.db) { await this.db.deleteWebSession(identity.sessionId); await this.db.audit({ id: randomUUID(), userId: identity.user.id, action: "account.logout", targetType: "web_session", targetId: identity.sessionId, outcome: "success", detail: {} }); }
    reply.header("set-cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  async getWebIdentity(request: FastifyRequest): Promise<CloudWebIdentity | null> {
    if (!this.db) return null;
    const rawToken = parseCookies(request.headers.cookie)[cookieName];
    if (!rawToken) return null;
    const session = await this.db.findWebSession(this.sessionHash(rawToken));
    if (!session) return null;
    const user = await this.db.findUserById(session.userId);
    if (!user || user.disabledAt) return null;
    void this.db.touchWebSession(session.id);
    return { user, sessionId: session.id };
  }

  async requireWebIdentity(request: FastifyRequest): Promise<CloudWebIdentity> {
    if (!this.required) {
      const fallback: CloudUser = { id: "local-operator", email: "local@browser-kit", passwordHash: "", createdAt: new Date(), disabledAt: null };
      return { user: fallback, sessionId: "local" };
    }
    const identity = await this.getWebIdentity(request);
    if (!identity) throw new BrowserKitError(errorCodes.unauthorized, "Sign in to Browser Kit Cloud", { status: 401 });
    return identity;
  }

  async issueApiKey(user: CloudUser, nameInput: string, scopesInput: string[], expiresAt?: Date): Promise<{ key: string; record: CloudApiKey }> {
    if (!this.db) throw new BrowserKitError(errorCodes.internal, "Cloud account storage is not configured", { status: 503 });
    const name = nameInput.trim().slice(0, 80);
    if (!name) throw new BrowserKitError(errorCodes.invalidRequest, "API key name is required", { status: 400 });
    const scopes = [...new Set(scopesInput.filter((scope): scope is CloudScope => (allowedScopes as readonly string[]).includes(scope)))];
    if (!scopes.length) throw new BrowserKitError(errorCodes.invalidRequest, "Select at least one valid API key scope", { status: 400 });
    const prefix = randomBytes(5).toString("hex");
    const key = `bk_live_${prefix}_${randomBytes(32).toString("base64url")}`;
    const record = await this.db.createApiKey({ id: randomUUID(), userId: user.id, name, prefix, verifierHash: this.keyHash(key), scopes, expiresAt: expiresAt ?? null });
    await this.db.audit({ id: randomUUID(), userId: user.id, action: "api_key.create", targetType: "api_key", targetId: record.id, outcome: "success", detail: { prefix, scopes } });
    return { key, record };
  }

  async listApiKeys(user: CloudUser): Promise<CloudApiKey[]> { if (!this.db) return []; return this.db.listApiKeys(user.id); }
  async revokeApiKey(user: CloudUser, id: string): Promise<void> { if (!this.db || !(await this.db.revokeApiKey(user.id, id))) throw new BrowserKitError(errorCodes.notFound, "API key was not found or has already been revoked", { status: 404 }); await this.db.audit({ id: randomUUID(), userId: user.id, action: "api_key.revoke", targetType: "api_key", targetId: id, outcome: "success", detail: {} }); }

  async authenticateApiKey(authorization: string | undefined): Promise<CloudActor> {
    const rawKey = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (this.config.apiKey && rawKey && rawKey.length === this.config.apiKey.length && timingSafeEqual(Buffer.from(rawKey), Buffer.from(this.config.apiKey))) return { kind: "operator" };
    if (!this.required) throw new BrowserKitError(errorCodes.unauthorized, "Missing or invalid API key", { status: 401 });
    if (!this.db || !rawKey.startsWith("bk_live_")) throw new BrowserKitError(errorCodes.unauthorized, "Missing or invalid cloud API key", { status: 401 });
    const [, , prefix] = rawKey.split("_", 4);
    const key = prefix ? await this.db.findApiKeyByPrefix(prefix) : null;
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date()) || !timingSafeEqual(Buffer.from(this.keyHash(rawKey)), Buffer.from(key.verifierHash))) throw new BrowserKitError(errorCodes.unauthorized, "Missing or invalid cloud API key", { status: 401 });
    const user = await this.db.findUserById(key.userId);
    if (!user || user.disabledAt) throw new BrowserKitError(errorCodes.unauthorized, "Cloud account is unavailable", { status: 401 });
    void this.db.touchApiKey(key.id);
    return { kind: "user", user, apiKey: key };
  }

  assertScope(actor: CloudActor, scope: CloudScope): void {
    if (actor.kind === "operator") return;
    if (!actor.apiKey.scopes.includes(scope)) throw new BrowserKitError(errorCodes.forbidden, `API key lacks ${scope} permission`, { status: 403 });
  }

  async assertBrowserOwnership(actor: CloudActor, sessionId: string): Promise<void> {
    if (actor.kind === "operator") return;
    if (!this.db || !(await this.db.ownsBrowserSession(sessionId, actor.user.id))) throw new BrowserKitError(errorCodes.notFound, "Browser session was not found", { status: 404 });
  }

  async claimBrowserSession(actor: CloudActor, sessionId: string): Promise<void> { if (actor.kind === "user" && this.db) await this.db.claimBrowserSession(sessionId, actor.user.id); }
  async closeBrowserSession(actor: CloudActor, sessionId: string): Promise<void> { if (actor.kind === "user" && this.db) await this.db.closeBrowserSession(sessionId, actor.user.id); }
}
