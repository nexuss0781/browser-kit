import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { BrowserCommand, CreateSessionOptions, ToolResult } from "browser-kit";
import { BrowserKitError, errorCodes } from "browser-kit";
import { loadConfig } from "./config.js";
import { registerHttpApi, pruneViewTokens } from "./http-api.js";
import { SessionManager } from "./session-manager.js";
import { CloudDatabase } from "./cloud-db.js";
import { CloudAuthService } from "./cloud-auth.js";

const config = loadConfig();
const app = Fastify({ logger: true });
const manager = new SessionManager(config);
const cloudDatabase = config.databaseUrl ? new CloudDatabase(config.databaseUrl) : undefined;
if (cloudDatabase) await cloudDatabase.initialize();
const cloudAuth = new CloudAuthService(config, cloudDatabase);
const { viewTokens, controlTokens } = await registerHttpApi(app, manager, config, cloudAuth);
const controlWss = new WebSocketServer({ noServer: true });
const appHtml = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../ui/app.html"), "utf8");

type AppActionLog = {
  id: string;
  sessionId?: string;
  command: string;
  status: "pending" | "success" | "error";
  summary: string;
  durationMs?: number;
  at: string;
};

const appActionLog: AppActionLog[] = [];

function appendAppAction(entry: Omit<AppActionLog, "id" | "at">): AppActionLog {
  const record: AppActionLog = { ...entry, id: randomUUID(), at: new Date().toISOString() };
  appActionLog.unshift(record);
  appActionLog.splice(120);
  return record;
}

function updateAppAction(id: string, patch: Partial<Omit<AppActionLog, "id">>): void {
  const record = appActionLog.find((item) => item.id === id);
  if (record) Object.assign(record, patch);
}

function summarizeAppCommand(command: BrowserCommand, result: ToolResult<unknown>): { status: "success" | "error"; summary: string } {
  if (!result.ok) return { status: "error", summary: result.error.message };
  const data = result.data as { url?: string; elements?: unknown[] } | undefined;
  if (command.type === "navigate") return { status: "success", summary: data?.url ? `Navigated to ${data.url}` : "Navigation complete" };
  if (command.type === "reload") return { status: "success", summary: "Reloaded current page" };
  if (command.type === "back") return { status: "success", summary: "Went back" };
  if (command.type === "forward") return { status: "success", summary: "Went forward" };
  if (command.type === "observe") return { status: "success", summary: `Observed ${data?.elements?.length ?? 0} interactive elements` };
  if (command.type === "screenshot") return { status: "success", summary: "Captured screenshot artifact" };
  return { status: "success", summary: "Browser command completed" };
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function authenticateUpgrade(url: URL, sessionId: string): boolean {
  const token = url.searchParams.get("token");
  if (!token) return false;
  const record = controlTokens.get(token);
  return Boolean(record && record.sessionId === sessionId && record.expiresAt > Date.now());
}

app.get("/", async (_request, reply) => reply.redirect("/app"));
app.get("/app/", async (_request, reply) => reply.redirect("/app"));
app.get("/app", async (request, reply) => {
  if (config.cloudAuthRequired && !(await cloudAuth.getWebIdentity(request))) return reply.redirect("/app/login");
  return reply.type("text/html; charset=utf-8").send(appHtml);
});
app.get("/app/login", async (_request, reply) => reply.type("text/html; charset=utf-8").send(appHtml));
app.get("/app/settings", async (request, reply) => {
  if (config.cloudAuthRequired && !(await cloudAuth.getWebIdentity(request))) return reply.redirect("/app/login");
  return reply.type("text/html; charset=utf-8").send(appHtml);
});

app.post<{ Body: { email?: string; password?: string } }>("/app/api/auth/register", async (request, reply) => {
  const user = await cloudAuth.register(request.body?.email ?? "", request.body?.password ?? "");
  const signedInUser = await cloudAuth.login(request.body?.email ?? "", request.body?.password ?? "", reply);
  return reply.code(201).send({ id: signedInUser.id, email: signedInUser.email, createdAt: user.createdAt });
});
app.post<{ Body: { email?: string; password?: string } }>("/app/api/auth/login", async (request, reply) => {
  const user = await cloudAuth.login(request.body?.email ?? "", request.body?.password ?? "", reply);
  return { id: user.id, email: user.email };
});
app.post("/app/api/auth/logout", async (request, reply) => { await cloudAuth.logout(request, reply); return { ok: true }; });
app.get("/app/api/auth/me", async (request) => {
  const identity = await cloudAuth.getWebIdentity(request);
  return identity ? { authenticated: true, user: { id: identity.user.id, email: identity.user.email } } : { authenticated: false };
});
app.get("/app/api/api-keys", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  const keys = await cloudAuth.listApiKeys(identity.user);
  return { data: keys.map((key) => ({ id: key.id, name: key.name, prefix: key.prefix, scopes: key.scopes, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt, expiresAt: key.expiresAt, revokedAt: key.revokedAt })) };
});
app.post<{ Body: { name?: string; scopes?: string[] } }>("/app/api/api-keys", async (request, reply) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  const issued = await cloudAuth.issueApiKey(identity.user, request.body?.name ?? "", request.body?.scopes ?? []);
  return reply.code(201).send({ key: issued.key, record: { id: issued.record.id, name: issued.record.name, prefix: issued.record.prefix, scopes: issued.record.scopes, createdAt: issued.record.createdAt } });
});
app.post<{ Params: { id: string } }>("/app/api/api-keys/:id/revoke", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  await cloudAuth.revokeApiKey(identity.user, request.params.id);
  return { ok: true };
});

app.get("/app/api/status", async () => ({
  service: "browser-kit",
  status: "ok",
  host: new URL(config.publicUrl).host,
  protected: config.cloudAuthRequired || Boolean(config.apiKey),
  cloudAuthRequired: config.cloudAuthRequired,
}));

app.get("/app/api/sessions", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  if (!cloudAuth.db || identity.user.id === "local-operator") return { data: manager.list() };
  const owned = await cloudAuth.db.listOwnedBrowserSessionIds(identity.user.id);
  return { data: manager.list().filter((session) => owned.includes(session.id)) };
});

app.get<{ Querystring: { sessionId?: string } }>("/app/api/action-log", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  const owned = cloudAuth.db && identity.user.id !== "local-operator" ? new Set(await cloudAuth.db.listOwnedBrowserSessionIds(identity.user.id)) : null;
  return { data: appActionLog.filter((entry) => (!owned || !entry.sessionId || owned.has(entry.sessionId)) && (!request.query.sessionId || entry.sessionId === request.query.sessionId)).slice(0, 60) };
});

app.get<{ Params: { id: string } }>("/app/api/sessions/:id/tabs", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  if (identity.user.id !== "local-operator" && cloudAuth.db && !(await cloudAuth.db.ownsBrowserSession(request.params.id, identity.user.id))) throw new BrowserKitError(errorCodes.notFound, "Browser session was not found", { status: 404 });
  return manager.listTabs(request.params.id);
});

app.post<{ Params: { id: string }; Body: { url?: string } }>("/app/api/sessions/:id/tabs", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  if (identity.user.id !== "local-operator" && cloudAuth.db && !(await cloudAuth.db.ownsBrowserSession(request.params.id, identity.user.id))) throw new BrowserKitError(errorCodes.notFound, "Browser session was not found", { status: 404 });
  return manager.createTab(request.params.id, request.body?.url);
});

app.post<{ Params: { id: string; tabId: string } }>("/app/api/sessions/:id/tabs/:tabId/activate", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  if (identity.user.id !== "local-operator" && cloudAuth.db && !(await cloudAuth.db.ownsBrowserSession(request.params.id, identity.user.id))) throw new BrowserKitError(errorCodes.notFound, "Browser session was not found", { status: 404 });
  return manager.activateTab(request.params.id, request.params.tabId);
});

app.post<{ Params: { id: string; tabId: string } }>("/app/api/sessions/:id/tabs/:tabId/close", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  if (identity.user.id !== "local-operator" && cloudAuth.db && !(await cloudAuth.db.ownsBrowserSession(request.params.id, identity.user.id))) throw new BrowserKitError(errorCodes.notFound, "Browser session was not found", { status: 404 });
  return manager.closeTab(request.params.id, request.params.tabId);
});

app.post<{ Body: CreateSessionOptions }>("/app/api/sessions", async (request, reply) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  const log = appendAppAction({ command: "session.start", status: "pending", summary: "Provisioning isolated Chrome session" });
  const started = Date.now();
  try {
    const session = await manager.create({
      viewport: request.body?.viewport ?? { width: 1440, height: 900 },
      profile: request.body?.profile ?? "ephemeral",
      labels: { ...(request.body?.labels ?? {}), source: "browser-kit-app" },
    });
    if (identity.user.id !== "local-operator" && cloudAuth.db) await cloudAuth.db.claimBrowserSession(session.id, identity.user.id);
    updateAppAction(log.id, { sessionId: session.id, status: "success", summary: `Session ${session.id.slice(0, 8)} is ready`, durationMs: Date.now() - started });
    return reply.code(201).send(session);
  } catch (error) {
    updateAppAction(log.id, { status: "error", summary: error instanceof Error ? error.message : "Unable to start browser session", durationMs: Date.now() - started });
    throw error;
  }
});

app.post<{ Params: { id: string } }>("/app/api/sessions/:id/close", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  if (identity.user.id !== "local-operator" && cloudAuth.db && !(await cloudAuth.db.ownsBrowserSession(request.params.id, identity.user.id))) throw new BrowserKitError(errorCodes.notFound, "Browser session was not found", { status: 404 });
  const log = appendAppAction({ sessionId: request.params.id, command: "session.close", status: "pending", summary: "Closing active browser session" });
  const started = Date.now();
  try {
    await manager.close(request.params.id, "app_requested");
    if (identity.user.id !== "local-operator" && cloudAuth.db) await cloudAuth.db.closeBrowserSession(request.params.id, identity.user.id);
    updateAppAction(log.id, { status: "success", summary: "Session closed and context cleared", durationMs: Date.now() - started });
    return { ok: true, sessionId: request.params.id };
  } catch (error) {
    updateAppAction(log.id, { status: "error", summary: error instanceof Error ? error.message : "Unable to close browser session", durationMs: Date.now() - started });
    throw error;
  }
});

app.post<{ Params: { id: string }; Body: { mode?: "readonly" | "readwrite" } }>("/app/api/sessions/:id/live-view", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  if (identity.user.id !== "local-operator" && cloudAuth.db && !(await cloudAuth.db.ownsBrowserSession(request.params.id, identity.user.id))) throw new BrowserKitError(errorCodes.notFound, "Browser session was not found", { status: 404 });
  manager.get(request.params.id);
  const token = randomUUID();
  const mode = request.body?.mode ?? "readwrite";
  const expiresAt = Date.now() + 300_000;
  viewTokens.set(token, { sessionId: request.params.id, mode, expiresAt });
  return {
    sessionId: request.params.id,
    mode,
    url: `/v1/sessions/${request.params.id}/live-view?token=${token}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
});

app.post<{ Params: { id: string }; Body: { command?: BrowserCommand } }>("/app/api/sessions/:id/commands", async (request) => {
  const identity = await cloudAuth.requireWebIdentity(request);
  if (identity.user.id !== "local-operator" && cloudAuth.db && !(await cloudAuth.db.ownsBrowserSession(request.params.id, identity.user.id))) throw new BrowserKitError(errorCodes.notFound, "Browser session was not found", { status: 404 });
  if (!request.body?.command || typeof request.body.command.type !== "string") {
    throw new BrowserKitError(errorCodes.invalidRequest, "Body must include a browser command", { status: 400 });
  }
  const command = request.body.command;
  const log = appendAppAction({ sessionId: request.params.id, command: command.type, status: "pending", summary: "Dispatching browser command" });
  const result = await manager.execute(request.params.id, command);
  const action = summarizeAppCommand(command, result);
  updateAppAction(log.id, { status: action.status, summary: action.summary, durationMs: result.durationMs });
  return result;
});

controlWss.on("connection", (socket: WebSocket, request) => {
  const sessionId = new URL(request.url ?? "/", "http://localhost").pathname.split("/")[3];
  if (!sessionId) {
    socket.close(1008, "Missing session ID");
    return;
  }
  let alive = true;
  const heartbeat = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, 15_000);
  socket.on("pong", () => { alive = true; });

  send(socket, { type: "connected", sessionId });
  socket.on("message", async (raw: RawData) => {
    try {
      const message = JSON.parse(raw.toString()) as { type?: string; command?: BrowserCommand };
      if (message.type === "ping") {
        send(socket, { type: "pong", at: new Date().toISOString() });
        return;
      }
      if (message.type !== "command" || !message.command) {
        send(socket, { type: "error", error: { code: errorCodes.invalidRequest, message: "Expected a command message" } });
        return;
      }
      const result = await manager.execute(sessionId, message.command);
      send(socket, { type: "command.result", result });
    } catch (error) {
      const normalized = error instanceof BrowserKitError ? error : new BrowserKitError(errorCodes.internal, "Control channel failed", { cause: error });
      send(socket, { type: "error", error: { code: normalized.code, message: normalized.message, retryable: normalized.retryable } });
    }
  });
  socket.on("close", () => clearInterval(heartbeat));
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>("/v1/sessions/:id/live-view", async (request, reply) => {
  const token = request.query.token;
  const record = token ? viewTokens.get(token) : undefined;
  if (!record || record.sessionId !== request.params.id || record.expiresAt <= Date.now()) {
    return reply.code(401).type("text/html").send("<h1>Browser view unavailable</h1><p>The live-view token is invalid or expired.</p>");
  }
  const mode = record.mode;
  const liveToken = token ?? "";
  const sessionId = request.params.id;
  return reply.type("text/html").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser Kit</title>
<style>html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif;height:100%;overflow:hidden}main{height:100%;display:flex;flex-direction:column}.bar{height:34px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#181818;border-bottom:1px solid #333;color:#aaa;font-size:12px}.screen-wrap{position:relative;flex:1;display:grid;place-items:center;overflow:auto;background:#050505}.screen{max-width:100%;max-height:100%;object-fit:contain;cursor:${mode === "readwrite" ? "crosshair" : "default"};user-select:none}.loading{position:absolute;display:grid;place-items:center;gap:9px;color:#bac6d3;font-size:12px;transition:opacity .15s}.loading[hidden]{display:none}.pulse{width:8px;height:8px;border-radius:999px;background:#76d8ff;box-shadow:0 0 14px #76d8ff;animation:pulse 900ms ease-in-out infinite alternate}@keyframes pulse{to{transform:scale(.65);opacity:.45}}.status{margin-left:auto}.error{color:#fca5a5}</style></head>
<body><main><div class="bar"><span>Browser Kit</span><span>${mode}</span><span class="status" id="status">Preparing first frame…</span></div><div class="screen-wrap"><div class="loading" id="loading"><span class="pulse"></span><span id="loading-copy">Preparing remote Chrome…</span></div><img id="screen" class="screen" alt="Live browser session" draggable="false"></div>
<script>
const sessionId = ${JSON.stringify(sessionId)};
const token = ${JSON.stringify(liveToken)};
const mode = ${JSON.stringify(mode)};
const screen = document.getElementById('screen');
const status = document.getElementById('status');
let objectUrl = '';
let closed = false;
let refreshing = false;
let frameCount = 0;
let refreshTimer = 0;
const loading = document.getElementById('loading');
const loadingCopy = document.getElementById('loading-copy');
function schedule(ms){ window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => void refresh(), ms); }
async function refresh(){
  if (closed || refreshing) return;
  refreshing = true;
  try {
    const response = await fetch('/v1/sessions/' + encodeURIComponent(sessionId) + '/live-view/screenshot?token=' + encodeURIComponent(token), {cache:'no-store'});
    if (!response.ok) throw new Error('screenshot ' + response.status);
    const next = URL.createObjectURL(await response.blob());
    await new Promise((resolve,reject)=>{const probe=new Image();probe.onload=resolve;probe.onerror=reject;probe.src=next});
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = next;
    screen.src = next;
    loading.hidden = true;
    status.textContent = 'Live';
    status.className = 'status';
    frameCount += 1;
    schedule(document.hidden ? 2000 : frameCount < 3 ? 160 : 450);
  } catch (error) {
    status.textContent = 'Disconnected';
    status.className = 'status error';
    loading.hidden = false;
    loadingCopy.textContent = 'Reconnecting remote Chrome…';
    window.parent.postMessage('browser-kit-disconnected', '*');
    schedule(1500);
  } finally {
    refreshing = false;
  }
}
function command(command){
  if (mode !== 'readwrite') return;
  return fetch('/v1/sessions/' + encodeURIComponent(sessionId) + '/live-view/command?token=' + encodeURIComponent(token), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command})});
}
screen.addEventListener('click', (event) => {
  const rect = screen.getBoundingClientRect();
  const scaleX = screen.naturalWidth ? screen.naturalWidth / rect.width : 1;
  const scaleY = screen.naturalHeight ? screen.naturalHeight / rect.height : 1;
  void command({type:'click',x:Math.round((event.clientX - rect.left) * scaleX),y:Math.round((event.clientY - rect.top) * scaleY)});
});
window.addEventListener('keydown', (event) => {
  if (mode !== 'readwrite') return;
  event.preventDefault();
  void command({type:'press',key:event.key});
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
window.addEventListener('beforeunload', () => { closed = true; window.clearTimeout(refreshTimer); if (objectUrl) URL.revokeObjectURL(objectUrl); });
void refresh();
</script></main></body></html>`);
});

app.server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `http://${host}`);
  const match = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/control$/);
  const sessionId = match?.[1];
  if (!sessionId) return;
  if (!authenticateUpgrade(url, sessionId)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  controlWss.handleUpgrade(request, socket, head, (client) => {
    controlWss.emit("connection", client, request);
  });
});

const cleanup = async (signal: string) => {
  app.log.info({ signal }, "Graceful shutdown started");
  await app.close();
  await manager.closeAll();
  controlWss.close();
  process.exit(0);
};
process.once("SIGTERM", () => void cleanup("SIGTERM"));
process.once("SIGINT", () => void cleanup("SIGINT"));
setInterval(() => pruneViewTokens(viewTokens, controlTokens), 60_000).unref();

await app.listen({ port: config.port, host: config.host });
app.log.info({ port: config.port, host: config.host }, "Browser Kit engine ready");
