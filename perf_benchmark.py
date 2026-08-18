import json
import time
from pathlib import Path
import requests

BASE = "http://127.0.0.1:10000"
HEADERS = {"Authorization": "Bearer test-key", "Content-Type": "application/json"}
results = []
session_id = None


def call(name, method, path, body=None, headers=HEADERS, expected=None):
    started = time.perf_counter_ns()
    response = None
    error = None
    payload = None
    try:
        response = requests.request(method, BASE + path, headers=headers, json=body, timeout=45)
        try:
            payload = response.json()
        except Exception:
            payload = {"content_type": response.headers.get("content-type"), "bytes": len(response.content)}
        if expected is not None and response.status_code != expected:
            error = f"expected HTTP {expected}, got {response.status_code}"
    except Exception as exc:
        error = repr(exc)
    elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
    nested_ok = not (isinstance(payload, dict) and payload.get("ok") is False)
    row = {
        "action": name,
        "method": method,
        "path": path,
        "http_status": response.status_code if response is not None else None,
        "elapsed_ms": round(elapsed_ms, 3),
        "ok": error is None and response is not None and response.ok and nested_ok,
        "error": error,
    }
    if isinstance(payload, dict):
        if "data" in payload and isinstance(payload["data"], dict):
            row["data_keys"] = sorted(payload["data"].keys())
        elif "error" in payload:
            row["error_code"] = payload["error"].get("code")
        elif "url" in payload:
            row["payload_keys"] = sorted(payload.keys())
        else:
            row["payload_keys"] = sorted(payload.keys())
    results.append(row)
    print(json.dumps(row), flush=True)
    return response, payload


call("health_live", "GET", "/health/live", headers={})
call("capabilities", "GET", "/v1/capabilities")
resp, payload = call("create_session", "POST", "/v1/sessions", {
    "viewport": {"width": 1440, "height": 900},
    "ttlSeconds": 300,
    "idleTimeoutSeconds": 120,
    "policy": {"allowEvaluate": False, "maxActionMs": 30000},
})
if resp is not None and resp.ok:
    session_id = payload["id"]

if session_id:
    call("get_session", "GET", f"/v1/sessions/{session_id}")
    call("connect", "POST", f"/v1/sessions/{session_id}/connect")
    call("navigate_google", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "navigate", "url": "https://www.google.com"}})
    call("fill_search_box", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "fill", "selector": "textarea[name=q]", "value": "browser kit performance test"}})
    call("press_enter", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "press", "key": "Enter"}})
    call("wait_for_search", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "wait", "ms": 5000}})
    call("observe_search_results", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "observe"}})
    call("screenshot_viewport", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "screenshot", "format": "jpeg"}})
    call("screenshot_full_page", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "screenshot", "fullPage": True, "format": "png"}})
    call("pdf", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "pdf"}})
    call("reload", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "reload"}})
    call("back", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "back"}})
    call("forward", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "forward"}})
    call("evaluate_policy_denied", "POST", f"/v1/sessions/{session_id}/commands", {"command": {"type": "evaluate", "expression": "document.title"}}, expected=200)
    view_resp, view_payload = call("live_view_token_engine_route", "POST", f"/v1/sessions/{session_id}/live-view", {"mode": "readonly", "ttlSeconds": 60})
    app_view_resp, app_view_payload = call("live_view_token_app_route", "POST", f"/app/api/sessions/{session_id}/live-view", {"mode": "readonly"}, headers={})
    if app_view_resp is not None and app_view_resp.ok:
        view_url = app_view_payload.get("url", "")
        token = view_url.split("token=", 1)[1] if "token=" in view_url else ""
        call("live_view_html", "GET", view_url.replace(BASE, "") if view_url.startswith(BASE) else view_url, headers={})
        call("live_view_screenshot", "GET", f"/v1/sessions/{session_id}/live-view/screenshot?token={token}", headers={})
    call("list_sessions", "GET", "/v1/sessions")
    call("close_session", "POST", f"/v1/sessions/{session_id}/close")

Path("/tmp/browser-kit-perf-results.json").write_text(json.dumps(results, indent=2))
print(f"Wrote {len(results)} measurements to /tmp/browser-kit-perf-results.json")

ok_rows = [r for r in results if r["ok"]]
if ok_rows:
    print(json.dumps({"successful_actions": len(ok_rows), "mean_ms": round(sum(r["elapsed_ms"] for r in ok_rows) / len(ok_rows), 3), "max_ms": max(r["elapsed_ms"] for r in ok_rows)}, indent=2))
