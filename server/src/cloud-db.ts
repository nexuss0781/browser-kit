import { Pool, type PoolClient } from "pg";

export type CloudUser = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  disabledAt: Date | null;
};

export type CloudWebSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
};

export type CloudApiKey = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  verifierHash: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type AuditEvent = {
  id: string;
  userId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: "success" | "failure";
  detail: Record<string, unknown>;
  at: Date;
};

const schema = `
CREATE TABLE IF NOT EXISTS cloud_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS cloud_web_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES cloud_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cloud_web_sessions_user_idx ON cloud_web_sessions(user_id);
CREATE INDEX IF NOT EXISTS cloud_web_sessions_expiry_idx ON cloud_web_sessions(expires_at);
CREATE TABLE IF NOT EXISTS cloud_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES cloud_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,
  verifier_hash TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cloud_api_keys_user_idx ON cloud_api_keys(user_id);
CREATE TABLE IF NOT EXISTS cloud_browser_sessions (
  engine_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES cloud_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cloud_browser_sessions_user_idx ON cloud_browser_sessions(user_id);
CREATE TABLE IF NOT EXISTS cloud_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES cloud_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cloud_audit_events_user_idx ON cloud_audit_events(user_id, at DESC);
`;

function asUser(row: Record<string, unknown>): CloudUser {
  return { id: String(row.id), email: String(row.email), passwordHash: String(row.password_hash), createdAt: new Date(String(row.created_at)), disabledAt: row.disabled_at ? new Date(String(row.disabled_at)) : null };
}

function asWebSession(row: Record<string, unknown>): CloudWebSession {
  return { id: String(row.id), userId: String(row.user_id), tokenHash: String(row.token_hash), expiresAt: new Date(String(row.expires_at)), lastSeenAt: new Date(String(row.last_seen_at)), createdAt: new Date(String(row.created_at)) };
}

function asApiKey(row: Record<string, unknown>): CloudApiKey {
  return { id: String(row.id), userId: String(row.user_id), name: String(row.name), prefix: String(row.key_prefix), verifierHash: String(row.verifier_hash), scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [], createdAt: new Date(String(row.created_at)), lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)) : null, expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null, revokedAt: row.revoked_at ? new Date(String(row.revoked_at)) : null };
}

export class CloudDatabase {
  readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? undefined : { rejectUnauthorized: false } });
  }

  async initialize(): Promise<void> {
    await this.pool.query(schema);
    await this.pool.query("DELETE FROM cloud_web_sessions WHERE expires_at <= NOW()");
  }

  async close(): Promise<void> { await this.pool.end(); }

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async createUser(user: Pick<CloudUser, "id" | "email" | "passwordHash">): Promise<CloudUser> {
    const result = await this.pool.query("INSERT INTO cloud_users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING *", [user.id, user.email, user.passwordHash]);
    return asUser(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<CloudUser | null> {
    const result = await this.pool.query("SELECT * FROM cloud_users WHERE email = $1 LIMIT 1", [email]);
    return result.rows[0] ? asUser(result.rows[0]) : null;
  }

  async findUserById(id: string): Promise<CloudUser | null> {
    const result = await this.pool.query("SELECT * FROM cloud_users WHERE id = $1 LIMIT 1", [id]);
    return result.rows[0] ? asUser(result.rows[0]) : null;
  }

  async createWebSession(session: Omit<CloudWebSession, "createdAt" | "lastSeenAt">): Promise<CloudWebSession> {
    const result = await this.pool.query("INSERT INTO cloud_web_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING *", [session.id, session.userId, session.tokenHash, session.expiresAt]);
    return asWebSession(result.rows[0]);
  }

  async findWebSession(tokenHash: string): Promise<CloudWebSession | null> {
    const result = await this.pool.query("SELECT * FROM cloud_web_sessions WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1", [tokenHash]);
    return result.rows[0] ? asWebSession(result.rows[0]) : null;
  }

  async touchWebSession(id: string): Promise<void> { await this.pool.query("UPDATE cloud_web_sessions SET last_seen_at = NOW() WHERE id = $1", [id]); }
  async deleteWebSession(id: string): Promise<void> { await this.pool.query("DELETE FROM cloud_web_sessions WHERE id = $1", [id]); }

  async createApiKey(key: Omit<CloudApiKey, "createdAt" | "lastUsedAt" | "revokedAt">): Promise<CloudApiKey> {
    const result = await this.pool.query("INSERT INTO cloud_api_keys (id, user_id, name, key_prefix, verifier_hash, scopes, expires_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING *", [key.id, key.userId, key.name, key.prefix, key.verifierHash, JSON.stringify(key.scopes), key.expiresAt]);
    return asApiKey(result.rows[0]);
  }

  async listApiKeys(userId: string): Promise<CloudApiKey[]> {
    const result = await this.pool.query("SELECT * FROM cloud_api_keys WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
    return result.rows.map(asApiKey);
  }

  async findApiKeyByPrefix(prefix: string): Promise<CloudApiKey | null> {
    const result = await this.pool.query("SELECT * FROM cloud_api_keys WHERE key_prefix = $1 LIMIT 1", [prefix]);
    return result.rows[0] ? asApiKey(result.rows[0]) : null;
  }

  async touchApiKey(id: string): Promise<void> { await this.pool.query("UPDATE cloud_api_keys SET last_used_at = NOW() WHERE id = $1", [id]); }
  async revokeApiKey(userId: string, id: string): Promise<boolean> { const result = await this.pool.query("UPDATE cloud_api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [id, userId]); return result.rowCount === 1; }

  async claimBrowserSession(engineSessionId: string, userId: string): Promise<void> { await this.pool.query("INSERT INTO cloud_browser_sessions (engine_session_id, user_id) VALUES ($1, $2) ON CONFLICT (engine_session_id) DO UPDATE SET user_id = EXCLUDED.user_id, closed_at = NULL", [engineSessionId, userId]); }
  async ownsBrowserSession(engineSessionId: string, userId: string): Promise<boolean> { const result = await this.pool.query("SELECT 1 FROM cloud_browser_sessions WHERE engine_session_id = $1 AND user_id = $2 AND closed_at IS NULL", [engineSessionId, userId]); return Boolean(result.rowCount); }
  async listOwnedBrowserSessionIds(userId: string): Promise<string[]> { const result = await this.pool.query("SELECT engine_session_id FROM cloud_browser_sessions WHERE user_id = $1 AND closed_at IS NULL", [userId]); return result.rows.map((row) => String(row.engine_session_id)); }
  async closeBrowserSession(engineSessionId: string, userId: string): Promise<void> { await this.pool.query("UPDATE cloud_browser_sessions SET closed_at = NOW() WHERE engine_session_id = $1 AND user_id = $2", [engineSessionId, userId]); }

  async audit(event: Omit<AuditEvent, "at">): Promise<void> {
    await this.pool.query("INSERT INTO cloud_audit_events (id, user_id, action, target_type, target_id, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)", [event.id, event.userId, event.action, event.targetType, event.targetId, event.outcome, JSON.stringify(event.detail)]);
  }
}
