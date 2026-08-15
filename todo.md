# Browser Kit Cloud Credential TODO

- [x] Select and document the initial login method and durable storage required for cloud user accounts.
- [x] Add a durable database-backed user, session, API-key, scope, and key-revocation data model.
- [x] Add user registration, login, logout, session validation, and password-security controls.
- [x] Add cloud API-key creation, one-time display, listing, last-used tracking, scope validation, and revocation APIs.
- [x] Replace global key-only `/v1` authentication with cloud-issued user-key validation while retaining an optional operator bootstrap key.
- [x] Attribute browser sessions, console action logs, and live-view-token minting to the authenticated cloud user.
- [x] Build `/app/login` and `/app/settings` pages for account access and API-key management.
- [x] Update the TypeScript SDK documentation for user cloud keys and clear authentication errors.
- [x] Update Docker, Render, deployment documentation, and security guidance for database-backed cloud key management.
- [x] Add unit and integration tests covering registration, login, key issuance, one-time secret display, authorization, and revocation.
- [x] Build, test, push, and verify the cloud-issued API key workflow.
- [ ] Extend durable user ownership to future artifact storage and quota enforcement when those capabilities are introduced.
