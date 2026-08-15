# Cloud-issued API keys

Browser Kit will issue **per-user cloud API keys** after a user signs in to the browser-kit cloud. The cloud—not the SDK and not the browser client—creates every key, stores only a one-way verifier, enforces scope and revocation, and records usage. This replaces the earlier shared `BROWSER_KIT_API_KEY` model for user SDK access.

## Initial identity model

The initial release uses built-in email and password registration and login rather than the removed inherited OAuth flow. A successful login creates a high-entropy, HTTP-only, secure, same-site session cookie. The `/app` control panel and `/app/settings` read the session on the server; the SDK instead sends a cloud-issued API key in the `Authorization: Bearer` header.

Passwords are never stored as plaintext. The implementation will use Argon2id password hashes, generic login failure messages, rate limits, and server-side session expiration. OWASP recommends secure password storage, generic authentication responses, TLS for authenticated flows, and server-side session state protected by unpredictable identifiers.[1] [2]

## Durable cloud storage

User accounts, web sessions, API-key metadata, revoked-key state, ownership of browser sessions, and audit events require a durable relational database. The intended Render deployment uses a Postgres database in the same region as the browser-kit web service and supplies its internal connection string through `DATABASE_URL`. Render supports defining a database and wiring its connection string into a web service through a Blueprint.[3] [4]

The first schema has five concepts:

| Record | Key fields | Purpose |
| --- | --- | --- |
| `users` | `id`, `email`, `password_hash`, timestamps | Cloud identity and account state. |
| `web_sessions` | hashed token, `user_id`, expiry, last seen | Signed-in control-panel session. |
| `api_keys` | key prefix, verifier hash, `user_id`, scopes, revoked/last-used timestamps | SDK credential lifecycle without storing the plaintext key. |
| `browser_sessions` | engine ID, `user_id`, lifecycle data | Enforces ownership on browser operations and live-view minting. |
| `audit_events` | actor, action, target, outcome, timestamp | Security and credential-use accountability. |

## API-key lifecycle

The cloud generates a key as `bk_live_<prefix>_<random-secret>` with Node’s cryptographically secure random generator. It returns the complete key **once**, at creation; after that the settings page shows only its name and safe prefix. The database stores a SHA-256 verifier of the complete key, never the key itself. Incoming SDK keys are parsed by prefix, looked up, verified with a constant-time comparison, scoped, rate-limited, and marked with `last_used_at`. Revocation immediately rejects further calls.

Keys are owner-scoped, can have bounded scopes such as `sessions:read`, `sessions:control`, `sessions:view`, and `sessions:close`, and can later gain expiration and rotation policies. Creation, display, use, and revocation generate audit events. This follows a centralized lifecycle with access control, revocation, rotation, and auditability rather than sharing a single long-lived secret.[5] [6]

## Migration from the shared service key

`BROWSER_KIT_API_KEY` remains an optional **operator bootstrap key** only. It is not shown in the UI and is not intended for SDK users. When `CLOUD_AUTH_REQUIRED=true`, `/v1/*` accepts only a validated cloud-issued user key (or the explicitly configured operator key for recovery and service administration). The `/app` console requires a signed-in user, and every browser session is attributed to that user.

## Required Render configuration

The user must create or connect a Render Postgres database before enabling cloud accounts. Set `DATABASE_URL` to its internal connection string, `CLOUD_AUTH_REQUIRED=true`, and `CLOUD_SESSION_SECRET` to a generated secret. Do not commit any of these values. Render can inject a database connection string and generate secret values through `render.yaml`, while the dashboard can save and deploy environment changes securely.[3] [4]

## References

[1]: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html "OWASP Authentication Cheat Sheet"
[2]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP Session Management Cheat Sheet"
[3]: https://render.com/docs/blueprint-spec "Render Blueprint YAML Reference"
[4]: https://render.com/docs/postgresql-creating-connecting "Create and Connect to Render Postgres"
[5]: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html "OWASP Secrets Management Cheat Sheet"
[6]: https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html "OWASP Key Management Cheat Sheet"
