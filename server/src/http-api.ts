import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import type { BrowserCommand, CreateSessionOptions, LiveViewMode } from "browser-kit";
import { BrowserKitError, errorCodes } from "browser-kit";
import type { ServerConfig } from "./config.js";
import { SessionManager } from "./session-manager.js";
import { CloudAuthService, type CloudActor } from "./cloud-auth.js";
import { ArtifactStore } from "./artifact-store.js";

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

export async function registerHttpApi(app: FastifyInstance, manager: SessionManager, config: ServerConfig, cloudAuth: CloudAuthService, artifactStore = new ArtifactStore(config.artifactRoot)): Promise<ApiTokens> {
  const viewTokens = new Map<string, ViewTokenRecord>();
  const controlTokens = new Map<string, ControlTokenRecord>();
  const actors = new WeakMap<object, CloudActor>();
  await app.register(cors, { origin: true, credentials: true });
  await artifactStore.initialize();

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/v1/")) return;
    const isLiveViewTokenIssue = request.method === "POST" && /^\/v1\/sessions\/[^/]+\/live-view(?:\?.*)?$/.test(request.url);
    if (request.url.includes("/live-view") && !isLiveViewTokenIssue) return;
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

  app.get<{ Params: { id: string } }>("/v1/artifacts/:id", async (request, reply) => {
    const actor = requireActor(request);
    const artifact = await artifactStore.get(request.params.id);
    if (!artifact) throw new BrowserKitError(errorCodes.notFound, "Artifact was not found or has expired", { status: 404 });
    await cloudAuth.assertBrowserOwnership(actor, artifact.record.sessionId);
    return reply.header("cache-control", "private, max-age=60").type(artifact.record.mimeType).send(artifact.data);
  });

  app.post<{ Params: { id: string }; Querystring: { token?: string }; Body: { command: BrowserCommand } }>("/v1/sessions/:id/live-view/command", async (request, reply) => {
    const token = request.query.token;
    const view = token ? viewTokens.get(token) : undefined;
    if (!view || view.sessionId !== request.params.id || view.expiresAt <= Date.now()) throw new BrowserKitError(errorCodes.unauthorized, "Invalid or expired live-view token", { status: 401 });
    if (view.mode !== "readwrite") throw new BrowserKitError(errorCodes.forbidden, "This live view is read-only", { status: 403 });
    if (!request.body?.command || typeof request.body.command.type !== "string") throw new BrowserKitError(errorCodes.invalidRequest, "Body must include a browser command", { status: 400 });
    const result = await manager.execute(request.params.id, request.body.command);
    return sendCommandResult(reply, result, artifactStore);
  });

  app.post<{ Params: { id: string }; Body: { commands: BrowserCommand[]; continueOnError?: boolean } }>("/v1/sessions/:id/commands/batch", async (request, reply) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:control");
    await cloudAuth.assertBrowserOwnership(actor, request.params.id);
    const commands = request.body?.commands;
    if (!Array.isArray(commands) || commands.length === 0 || commands.length > 32 || commands.some((command) => !command || typeof command.type !== "string")) {
      throw new BrowserKitError(errorCodes.invalidRequest, "Body must include between 1 and 32 browser commands", { status: 400 });
    }
    const started = Date.now();
    const results: Awaited<ReturnType<SessionManager["execute"]>>[] = [];
    for (const command of commands) {
      const result = await manager.execute(request.params.id, command);
      if (result.ok) decorateArtifactResult(result, artifactStore);
      results.push(result);
      if (!result.ok && request.body.continueOnError !== true) break;
    }
    const failed = results.filter((result) => !result.ok).length;
    const browserMs = results.reduce((total, result) => total + (result.timings?.browserMs ?? 0), 0);
    reply.header("server-timing", `batch;dur=${Date.now() - started}, browser;dur=${browserMs}`);
    return reply.code(200).send({ ok: failed === 0, batchId: randomUUID(), sessionId: request.params.id, results, completed: results.length, failed, durationMs: Date.now() - started });
  });

  app.post<{ Params: { id: string }; Body: { command: BrowserCommand } }>("/v1/sessions/:id/commands", async (request, reply) => {
    const actor = requireActor(request);
    cloudAuth.assertScope(actor, "sessions:control");
    await cloudAuth.assertBrowserOwnership(actor, request.params.id);
    if (!request.body?.command || typeof request.body.command.type !== "string") {
      throw new BrowserKitError(errorCodes.invalidRequest, "Body must include a browser command", { status: 400 });
    }
    const result = await manager.execute(request.params.id, request.body.command);
    return sendCommandResult(reply, result, artifactStore);
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

function decorateArtifactResult(result: Awaited<ReturnType<SessionManager["execute"]>> & { ok: true }, artifactStore: ArtifactStore): void {
  const data = result.data as { mimeType?: string; base64?: string } | undefined;
  if (data?.mimeType && data.base64) {
    const artifact = artifactStore.enqueue(result.sessionId, data.mimeType, data.base64);
    result.data = { ...data, artifactId: artifact.id, artifactUrl: `/v1/artifacts/${artifact.id}`, bytes: artifact.bytes, expiresAt: artifact.expiresAt };
  }
}

async function sendCommandResult(reply: FastifyReply, result: Awaited<ReturnType<SessionManager["execute"]>>, artifactStore: ArtifactStore): Promise<unknown> {
  const timings = result.timings;
  if (timings) reply.header("server-timing", `admission;dur=${timings.admissionMs}, browser;dur=${timings.browserMs}, total;dur=${timings.totalMs}`);
  if (result.ok) {
    decorateArtifactResult(result, artifactStore);
    return reply.code(200).send(result);
  }
  const status = result.error.code === errorCodes.invalidRequest ? 400
    : result.error.code === errorCodes.unauthorized ? 401
      : result.error.code === errorCodes.forbidden || result.error.code === errorCodes.policyDenied ? 403
        : result.error.code === errorCodes.notFound ? 404
          : result.error.code === errorCodes.sessionExpired ? 410
            : result.error.code === errorCodes.sessionLimit ? 429
              : result.error.code === errorCodes.navigationTimeout || result.error.code === errorCodes.actionTimeout ? 504
                : result.error.retryable ? 503 : 500;
  return reply.code(status).send(result);
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
