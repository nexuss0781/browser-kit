import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { BrowserCommand, CreateSessionOptions, LiveViewMode } from "browser-kit";
import { BrowserKitError, errorCodes } from "browser-kit";
import type { ServerConfig } from "./config.js";
import { SessionManager } from "./session-manager.js";
import { CloudAuthService, type CloudActor } from "./cloud-auth.js";

export interface ViewTokenRecord {
  sessionId: string;
  mode: LiveViewMode;
  expiresAt: number;
}

export interface ControlTokenRecord {
  sessionId: string;
  expiresAt: number;
}

export interface ApiTokens {
  viewTokens: Map<string, ViewTokenRecord>;
  controlTokens: Map<string, ControlTokenRecord>;
}

export async function registerHttpApi(app: FastifyInstance, manager: SessionManager, config: ServerConfig, cloudAuth: CloudAuthService): Promise<ApiTokens> {
  const viewTokens = new Map<string, ViewTokenRecord>();
  const controlTokens = new Map<string, ControlTokenRecord>();
  const actors = new WeakMap<object, CloudActor>();
  await app.register(cors, { origin: true, credentials: true });

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/v1/")) return;
    if (request.url.includes("/live-view")) return;
    actors.set(request, await cloudAuth.authenticateApiKey(request.headers.authorization));
  });

  const requireActor = (request: object): CloudActor => {
    const actor = actors.get(request);
    if (!actor) throw new BrowserKitError(errorCodes.unauthorized, "Missing or invalid cloud API key", { status: 401 });
    return actor;
  };

  app.get("/health/live", async () => ({ ok: true, service: "browser-kit" }));
  app.get("/health/ready", async () => ({ ok: true, service: "browser-kit", sessions: manager.list().length, maxSessions: config.maxSessions }));
  app.get("/v1/capabilities", async () => ({
    apiVersion: "v1",
    engineVersion: "0.1.0",
    commands: ["navigate", "reload", "back", "forward", "observe", "click", "fill", "type", "press", "scroll", "hover", "screenshot", "pdf", "wait", "evaluate", "close"],
    liveView: { modes: ["readonly", "readwrite"], transports: ["iframe-placeholder"] },
  }));

  app.post<{ Body: CreateSessionOptions }>("/v1/sessions", async (request, reply) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:control");
    const session = await manager.create(request.body ?? {});
    await cloudAuth.claimBrowserSession(actor, session.id);
    return reply.code(201).send(session);
  });

  app.get("/v1/sessions", async (request) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:read");
    if (actor.kind === "operator") return { data: manager.list() };
    const owned = await cloudAuth.db?.listOwnedBrowserSessionIds(actor.user.id) ?? [];
    return { data: manager.list().filter((session) => owned.includes(session.id)) };
  });

  app.get<{ Params: { id: string } }>("/v1/sessions/:id", async (request) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:read");
    await cloudAuth.assertBrowserOwnership(actor, request.params.id);
    manager.get(request.params.id);
    return manager.list().find((session) => session.id === request.params.id);
  });

  app.post<{ Params: { id: string } }>("/v1/sessions/:id/connect", async (request) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:control");
    await cloudAuth.assertBrowserOwnership(actor, request.params.id);
    const connection = await manager.connect(request.params.id, config.publicUrl);
    const token = randomUUID();
    const expiresAt = Date.now() + 300_000;
    controlTokens.set(token, { sessionId: request.params.id, expiresAt });
    return { ...connection, controlUrl: `${connection.controlUrl}?token=${token}` };
  });

  app.post<{ Params: { id: string }; Body: { mode?: LiveViewMode; ttlSeconds?: number } }>("/v1/sessions/:id/live-view", async (request) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:view");
    await cloudAuth.assertBrowserOwnership(actor, request.params.id);
    manager.get(request.params.id);
    const token = randomUUID();
    const ttlSeconds = Math.min(Math.max(request.body?.ttlSeconds ?? 300, 30), 900);
    const mode = request.body?.mode ?? "readonly";
    viewTokens.set(token, { sessionId: request.params.id, mode, expiresAt: Date.now() + ttlSeconds * 1000 });
    return {
      sessionId: request.params.id,
      mode,
      token,
      url: `${config.publicUrl.replace(/\/$/, "")}/v1/sessions/${request.params.id}/live-view?token=${token}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  });

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>("/v1/sessions/:id/live-view/screenshot", async (request, reply) => {
    const token = request.query.token;
    const view = token ? viewTokens.get(token) : undefined;
    if (!view || view.sessionId !== request.params.id || view.expiresAt <= Date.now()) throw new BrowserKitError(errorCodes.unauthorized, "Invalid or expired live-view token", { status: 401 });
    const frame = await manager.captureLiveFrame(request.params.id);
    return reply.header("cache-control", "no-store").header("content-encoding", "identity").type("image/jpeg").send(frame);
  });

  app.post<{ Params: { id: string }; Querystring: { token?: string }; Body: { command: BrowserCommand } }>("/v1/sessions/:id/live-view/command", async (request) => {
    const token = request.query.token;
    const view = token ? viewTokens.get(token) : undefined;
    if (!view || view.sessionId !== request.params.id || view.expiresAt <= Date.now()) throw new BrowserKitError(errorCodes.unauthorized, "Invalid or expired live-view token", { status: 401 });
    if (view.mode !== "readwrite") throw new BrowserKitError(errorCodes.forbidden, "This live view is read-only", { status: 403 });
    if (!request.body?.command || typeof request.body.command.type !== "string") throw new BrowserKitError(errorCodes.invalidRequest, "Body must include a browser command", { status: 400 });
    return manager.execute(request.params.id, request.body.command);
  });

  app.post<{ Params: { id: string }; Body: { command: BrowserCommand } }>("/v1/sessions/:id/commands", async (request) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:control");
    await cloudAuth.assertBrowserOwnership(actor, request.params.id);
    if (!request.body?.command || typeof request.body.command.type !== "string") {
      throw new BrowserKitError(errorCodes.invalidRequest, "Body must include a browser command", { status: 400 });
    }
    return manager.execute(request.params.id, request.body.command);
  });

  app.post<{ Params: { id: string } }>("/v1/sessions/:id/close", async (request) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:close");
    await cloudAuth.assertBrowserOwnership(actor, request.params.id);
    await manager.close(request.params.id, "api_requested");
    await cloudAuth.closeBrowserSession(actor, request.params.id);
    return { ok: true, sessionId: request.params.id };
  });

  app.setErrorHandler((error, _request, reply) => {
    const normalized = error instanceof BrowserKitError
      ? error
      : new BrowserKitError(errorCodes.internal, error instanceof Error ? error.message : "Internal server error", { status: 500, cause: error });
    return reply.code(normalized.status ?? 500).send({
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        ...(normalized.details ? { details: normalized.details } : {}),
      },
    });
  });

  return { viewTokens, controlTokens };
}

export function pruneViewTokens(tokens: Map<string, ViewTokenRecord>, controlTokens?: Map<string, ControlTokenRecord>): void {
  const now = Date.now();
  for (const [token, record] of tokens) {
    if (record.expiresAt <= now) tokens.delete(token);
  }
  if (controlTokens) {
    for (const [token, record] of controlTokens) {
      if (record.expiresAt <= now) controlTokens.delete(token);
    }
  }
}
