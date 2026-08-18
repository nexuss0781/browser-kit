import base64
import json
import os
import statistics
import time
from pathlib import Path
import requests
from PIL import Image

FIXTURE = "http://127.0.0.1:18080/workbench.html"
RUNS = int(os.environ.get("AUDIT_RUNS", "5"))
AUTH = {"Authorization": "Bearer test-key"}
JSON_HEADERS = {**AUTH, "Content-Type": "application/json"}
OUT = Path("/tmp/browser-kit-before-after")
OUT.mkdir(parents=True, exist_ok=True)

SEQUENCE = [
    ("navigate_workbench", lambda sid: {"type": "navigate", "url": FIXTURE}),
    ("observe_ready", lambda sid: {"type": "observe"}),
    ("fill_query", lambda sid: {"type": "fill", "selector": "#query", "value": "performance"}),
    ("press_enter", lambda sid: {"type": "press", "key": "Enter"}),
    ("wait_results", lambda sid: {"type": "wait", "selector": "[data-result] article"}),
    ("observe_results", lambda sid: {"type": "observe"}),
    ("click_result", lambda sid: {"type": "click", "selector": 'a[data-result-ref="result-0"]'}),
    ("hover_target", lambda sid: {"type": "hover", "selector": "#hover-target"}),
    ("fill_contenteditable", lambda sid: {"type": "fill", "selector": "#notes", "value": "Verified by Browser Kit"}),
    ("scroll_page", lambda sid: {"type": "scroll", "deltaY": 600}),
    ("reload_page", lambda sid: {"type": "reload"}),
    ("back_history", lambda sid: {"type": "back"}),
    ("forward_history", lambda sid: {"type": "forward"}),
    ("screenshot_results", lambda sid: {"type": "screenshot", "fullPage": True, "format": "png"}),
    ("screenshot_viewport", lambda sid: {"type": "screenshot", "format": "jpeg"}),
    ("pdf", lambda sid: {"type": "pdf"}),
]

def request(base, session, method, path, body=None):
    headers = JSON_HEADERS if body is not None else AUTH
    start = time.perf_counter_ns()
    response = session.request(method, base + path, headers=headers, json=body, timeout=45)
    elapsed = (time.perf_counter_ns() - start) / 1_000_000
    try:
        payload = response.json()
    except Exception:
        payload = None
    command_ok = not (isinstance(payload, dict) and payload.get("ok") is False)
    row = {"http_ms": round(elapsed, 3), "http_status": response.status_code, "command_ok": command_ok}
    if response.headers.get("server-timing"):
        row["server_timing"] = response.headers["server-timing"]
    if isinstance(payload, dict) and isinstance(payload.get("timings"), dict):
        row["command_timings"] = payload["timings"]
    if isinstance(payload, dict) and payload.get("error"):
        row["error_code"] = payload["error"].get("code")
    return row, payload

def run_workflow(base, version, run_index, capture=False):
    session = requests.Session()
    rows = {}
    create, created = request(base, session, "POST", "/v1/sessions", {"viewport": {"width": 1440, "height": 900}, "ttlSeconds": 180, "policy": {"allowEvaluate": False, "allowPrivateNetwork": True}})
    rows["create_session"] = create
    if not created or "id" not in created:
        return rows
    sid = created["id"]
    for name, command_factory in SEQUENCE:
        row, payload = request(base, session, "POST", f"/v1/sessions/{sid}/commands", {"command": command_factory(sid)})
        rows[name] = row
        if capture and isinstance(payload, dict) and isinstance(payload.get("data"), dict) and payload["data"].get("base64"):
            data = payload["data"]
            ext = ".png" if data.get("mimeType") == "image/png" else ".jpg" if data.get("mimeType") == "image/jpeg" else ".pdf"
            (OUT / f"{version}-{name}{ext}").write_bytes(base64.b64decode(data["base64"]))
    close, _ = request(base, session, "POST", f"/v1/sessions/{sid}/close")
    rows["close_session"] = close
    return rows

def summarize(version, runs):
    names = list(runs[0].keys())
    summary = {"version": version, "runs": RUNS, "actions": {}}
    for name in names:
        values = [run[name]["http_ms"] for run in runs if name in run]
        ordered = sorted(values)
        summary["actions"][name] = {
            "mean_ms": round(statistics.mean(values), 3),
            "median_ms": round(statistics.median(values), 3),
            "p95_ms": round(ordered[max(0, int(len(ordered) * .95) - 1)], 3),
            "min_ms": round(min(values), 3),
            "max_ms": round(max(values), 3),
            "success_runs": sum(run.get(name, {}).get("command_ok", False) for run in runs),
            "server_timing_observed": sum("server_timing" in run.get(name, {}) for run in runs),
        }
    totals = [sum(run[name]["http_ms"] for name in names if name in run) for run in runs]
    summary["workflow"] = {
        "mean_ms": round(statistics.mean(totals), 3),
        "median_ms": round(statistics.median(totals), 3),
        "p95_ms": round(sorted(totals)[max(0, int(len(totals) * .95) - 1)], 3),
        "success_runs": sum(all(run.get(name, {}).get("command_ok", False) for name in names) for run in runs),
    }
    return summary

configs = {
    "before": os.environ["BEFORE_BASE"],
    "after": os.environ["AFTER_BASE"],
}
report = {"runs": RUNS, "versions": {}, "visual_checks": {}}
for version, base in configs.items():
    runs = [run_workflow(base, version, i, capture=(i == 0)) for i in range(RUNS)]
    report["versions"][version] = {"summary": summarize(version, runs), "runs": runs}
    for name, dims in [("screenshot_results", (1440, None)), ("screenshot_viewport", (1440, 900))]:
        path = next((p for p in OUT.glob(f"{version}-{name}.*") if p.suffix in (".png", ".jpg")), None)
        if path:
            image = Image.open(path)
            report["visual_checks"][f"{version}_{name}"] = {"path": str(path), "dimensions": image.size, "non_empty": image.getbbox() is not None}
Path("/tmp/browser-kit-before-after-audit.json").write_text(json.dumps(report, indent=2))
print(json.dumps({version: report["versions"][version]["summary"] for version in report["versions"]}, indent=2))
print(json.dumps(report["visual_checks"], indent=2))
