import base64
import json
import os
import time
from pathlib import Path
import requests

BASE = os.environ.get("BROWSER_KIT_BASE", "http://127.0.0.1:10000")
FIXTURE = "http://127.0.0.1:18080/workbench.html"
OUT = Path("/tmp/browser-kit-local-visual")
OUT.mkdir(parents=True, exist_ok=True)
AUTH = {"Authorization": "Bearer test-key"}
JSON_HEADERS = {**AUTH, "Content-Type": "application/json"}
rows = []

def req(name, method, path, body=None):
    t0 = time.perf_counter_ns()
    headers = JSON_HEADERS if body is not None else AUTH
    r = requests.request(method, BASE + path, headers=headers, json=body, timeout=45)
    elapsed = (time.perf_counter_ns() - t0) / 1_000_000
    try:
        p = r.json()
    except Exception:
        p = None
    ok = r.ok and not (isinstance(p, dict) and p.get("ok") is False)
    row = {"action": name, "http": r.status_code, "elapsed_ms": round(elapsed, 3), "ok": ok}
    if r.headers.get("server-timing"):
        row["server_timing"] = r.headers["server-timing"]
    if isinstance(p, dict) and isinstance(p.get("timings"), dict):
        row["command_timings"] = p["timings"]
    if isinstance(p, dict) and p.get("error"):
        row["error_code"] = p["error"].get("code")
    rows.append(row)
    print(json.dumps(row), flush=True)
    return r, p

def command(sid, name, command):
    return req(name, "POST", f"/v1/sessions/{sid}/commands", {"command": command})

def save(name, payload):
    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    if "base64" not in data:
        return
    ext = ".png" if data.get("mimeType") == "image/png" else ".jpg"
    path = OUT / f"{name}{ext}"
    path.write_bytes(base64.b64decode(data["base64"]))

_, session = req("create_session", "POST", "/v1/sessions", {"viewport": {"width": 1440, "height": 900}, "ttlSeconds": 180, "policy": {"allowEvaluate": False}})
sid = session["id"]
command(sid, "navigate_workbench", {"type": "navigate", "url": FIXTURE})
command(sid, "observe_ready", {"type": "observe"})
command(sid, "fill_query", {"type": "fill", "selector": "#query", "value": "performance"})
command(sid, "press_enter", {"type": "press", "key": "Enter"})
command(sid, "wait_results", {"type": "wait", "selector": "[data-result] article"})
_, observed = command(sid, "observe_results", {"type": "observe"})
command(sid, "click_result", {"type": "click", "selector": 'a[data-result-ref="result-0"]'})
command(sid, "hover_target", {"type": "hover", "selector": "#hover-target"})
command(sid, "fill_contenteditable", {"type": "fill", "selector": "#notes", "value": "Verified by Browser Kit"})
command(sid, "scroll_page", {"type": "scroll", "deltaY": 600})
command(sid, "reload_page", {"type": "reload"})
command(sid, "back_history", {"type": "back"})
command(sid, "forward_history", {"type": "forward"})
command(sid, "evaluate_policy_denied", {"type": "evaluate", "expression": "document.title"})
_, screenshot = command(sid, "screenshot_results", {"type": "screenshot", "fullPage": True, "format": "png"})
save("01-local-results", screenshot[1] if False else screenshot)
_, viewport = command(sid, "screenshot_viewport", {"type": "screenshot", "format": "jpeg"})
save("02-local-viewport", viewport[1] if False else viewport)
_, pdf = command(sid, "pdf", {"type": "pdf"})
if isinstance(pdf, dict) and isinstance(pdf.get("data"), dict) and "base64" in pdf["data"]:
    (OUT / "03-local-results.pdf").write_bytes(base64.b64decode(pdf["data"]["base64"]))
req("close_session", "POST", f"/v1/sessions/{sid}/close")
(Path("/tmp/browser-kit-local-visual-results.json")).write_text(json.dumps({"actions": rows, "observed": observed}, indent=2))
print(json.dumps({"artifacts": sorted(p.name for p in OUT.iterdir()), "actions": len(rows)}, indent=2))
