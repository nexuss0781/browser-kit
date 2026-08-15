import Fastify from "fastify";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { BrowserCommand } from "browser-kit";
import { BrowserKitError, errorCodes } from "browser-kit";
import { loadConfig } from "./config.js";
import { registerHttpApi, pruneViewTokens } from "./http-api.js";
import { SessionManager } from "./session-manager.js";

const config = loadConfig();
const app = Fastify({ logger: true });
const manager = new SessionManager(config);
const { viewTokens, controlTokens } = await registerHttpApi(app, manager, config);
const controlWss = new WebSocketServer({ noServer: true });

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function authenticateUpgrade(url: URL, sessionId: string): boolean {
  const token = url.searchParams.get("token");
  if (!token) return false;
  const record = controlTokens.get(token);
  return Boolean(record && record.sessionId === sessionId && record.expiresAt > Date.now());
}

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
<style>html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif;height:100%;overflow:hidden}main{height:100%;display:flex;flex-direction:column}.bar{height:34px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#181818;border-bottom:1px solid #333;color:#aaa;font-size:12px}.screen-wrap{flex:1;display:grid;place-items:center;overflow:auto;background:#050505}.screen{max-width:100%;max-height:100%;object-fit:contain;cursor:${mode === "readwrite" ? "crosshair" : "default"};user-select:none}.status{margin-left:auto}.error{color:#fca5a5}</style></head>
<body><main><div class="bar"><span>Browser Kit</span><span>${mode}</span><span class="status" id="status">Connecting…</span></div><div class="screen-wrap"><img id="screen" class="screen" alt="Live browser session" draggable="false"></div>
<script>
const sessionId = ${JSON.stringify(sessionId)};
const token = ${JSON.stringify(liveToken)};
const mode = ${JSON.stringify(mode)};
const screen = document.getElementById('screen');
const status = document.getElementById('status');
let objectUrl = '';
let closed = false;
async function refresh(){
  if (closed) return;
  try {
    const response = await fetch('/v1/sessions/' + encodeURIComponent(sessionId) + '/live-view/screenshot?token=' + encodeURIComponent(token), {cache:'no-store'});
    if (!response.ok) throw new Error('screenshot ' + response.status);
    const next = URL.createObjectURL(await response.blob());
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = next;
    screen.src = next;
    status.textContent = 'Live';
    status.className = 'status';
  } catch (error) {
    status.textContent = 'Disconnected';
    status.className = 'status error';
    window.parent.postMessage('browser-kit-disconnected', '*');
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
window.setInterval(refresh, 800);
window.addEventListener('beforeunload', () => { closed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); });
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
