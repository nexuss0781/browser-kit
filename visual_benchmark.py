import base64
import json
import time
from pathlib import Path
import requests

BASE = "http://127.0.0.1:10000"
API = {"Authorization": "Bearer test-key", "Content-Type": "application/json"}
OUT = Path("/tmp/browser-kit-visual")
OUT.mkdir(parents=True, exist_ok=True)
rows = []

def request(name, method, path, body=None, headers=None):
    t0 = time.perf_counter_ns()
    request_headers = headers if headers is not None else (API if body is not None else {"Authorization": "Bearer test-key"})
    r = requests.request(method, BASE + path, headers=request_headers, json=body, timeout=45)
    elapsed = (time.perf_counter_ns() - t0) / 1_000_000
    try:
        payload = r.json()
    except Exception:
        payload = None
    nested_ok = not (isinstance(payload, dict) and payload.get("ok") is False)
    row = {"action": name, "path": path, "http": r.status_code, "elapsed_ms": round(elapsed, 3), "command_ok": nested_ok}
    if isinstance(payload, dict) and payload.get("error"):
        row["error_code"] = payload["error"].get("code")
    rows.append(row)
    print(json.dumps(row), flush=True)
    return r, payload

def command(session_id, name, command):
    r, p = request(name, "POST", f"/v1/sessions/{session_id}/commands", {"command": command})
    return r, p

def save_artifact(name, payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or "base64" not in data:
        return None
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf"}.get(data.get("mimeType"), ".bin")
    path = OUT / f"{name}{ext}"
    path.write_bytes(base64.b64decode(data["base64"]))
    return str(path)

_, session = request("create_session", "POST", "/v1/sessions", {"viewport": {"width": 1440, "height": 900}, "ttlSeconds": 300, "policy": {"allowEvaluate": False}})
sid = session["id"]
command(sid, "navigate_example", {"type": "navigate", "url": "https://example.com"})
_, before = command(sid, "observe_example", {"type": "observe"})
_, shot_before = command(sid, "screenshot_example", {"type": "screenshot", "fullPage": True, "format": "png"})
save_artifact("01-example", shot_before)
command(sid, "navigate_search", {"type": "navigate", "url": "https://www.google.com"})
command(sid, "fill_search", {"type": "fill", "selector": "textarea[name=q]", "value": "browser kit end to end performance"})
command(sid, "press_enter", {"type": "press", "key": "Enter"})
command(sid, "wait_search", {"type": "wait", "ms": 3000})
_, after = command(sid, "observe_search", {"type": "observe"})
_, shot_after = command(sid, "screenshot_search", {"type": "screenshot", "fullPage": True, "format": "png"})
save_artifact("02-search-results", shot_after)
_, shot_view = command(sid, "screenshot_viewport", {"type": "screenshot", "fullPage": False, "format": "jpeg"})
save_artifact("03-search-viewport", shot_view)
_, pdf = command(sid, "pdf", {"type": "pdf"})
save_artifact("04-search-page", pdf)
request("close_session", "POST", f"/v1/sessions/{sid}/close")

(Path("/tmp/browser-kit-visual-results.json")).write_text(json.dumps({"session_id": sid, "before_observe": before, "after_observe": after, "actions": rows}, indent=2))
print(json.dumps({"artifact_dir": str(OUT), "artifacts": sorted(p.name for p in OUT.iterdir()), "actions": len(rows)}, indent=2))
