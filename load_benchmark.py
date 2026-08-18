import json
import os
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests

BASE = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10001')
FIXTURE = 'http://127.0.0.1:18080/workbench.html'
AUTH = {'Authorization': 'Bearer test-key'}
JSON_HEADERS = {**AUTH, 'Content-Type': 'application/json'}

def call(session, method, path, body=None):
    headers = JSON_HEADERS if body is not None else AUTH
    t0 = time.perf_counter_ns()
    response = session.request(method, BASE + path, headers=headers, json=body, timeout=45)
    elapsed = (time.perf_counter_ns() - t0) / 1_000_000
    try:
        payload = response.json()
    except Exception:
        payload = None
    ok = response.ok and not (isinstance(payload, dict) and payload.get('ok') is False)
    return elapsed, ok, payload, response.status_code

def workflow(index):
    session = requests.Session()
    timings = {}
    errors = []
    elapsed, ok, payload, status = call(session, 'POST', '/v1/sessions', {'viewport': {'width': 1440, 'height': 900}, 'ttlSeconds': 180, 'policy': {'allowEvaluate': False}})
    timings['create_session_ms'] = elapsed
    if not ok:
        return {'index': index, 'ok': False, 'errors': [f'create:{status}'], 'timings': timings}
    sid = payload['id']
    commands = [
        ('navigate_ms', {'type': 'navigate', 'url': FIXTURE}),
        ('fill_ms', {'type': 'fill', 'selector': '#query', 'value': 'performance'}),
        ('press_ms', {'type': 'press', 'key': 'Enter'}),
        ('wait_ms', {'type': 'wait', 'selector': '[data-result] article'}),
        ('observe_ms', {'type': 'observe'}),
        ('screenshot_ms', {'type': 'screenshot', 'format': 'jpeg'}),
    ]
    for name, command in commands:
        elapsed, ok, payload, status = call(session, 'POST', f'/v1/sessions/{sid}/commands', {'command': command})
        timings[name] = elapsed
        if not ok:
            errors.append(f'{name}:{status}:{payload.get("error", {}).get("code") if isinstance(payload, dict) else "unknown"}')
    elapsed, close_ok, _, status = call(session, 'POST', f'/v1/sessions/{sid}/close')
    timings['close_ms'] = elapsed
    if not close_ok:
        errors.append(f'close:{status}')
    return {'index': index, 'ok': not errors, 'errors': errors, 'timings': timings}

def summarize(rows, label):
    values = [sum(row['timings'].values()) for row in rows]
    return {
        'label': label,
        'runs': len(rows),
        'successful_runs': sum(row['ok'] for row in rows),
        'failed_runs': sum(not row['ok'] for row in rows),
        'total_workflow_mean_ms': round(statistics.mean(values), 3),
        'total_workflow_p50_ms': round(statistics.median(values), 3),
        'total_workflow_p95_ms': round(sorted(values)[max(0, int(len(values) * .95) - 1)], 3),
        'total_workflow_max_ms': round(max(values), 3),
    }

sequential = [workflow(i) for i in range(1, 6)]
concurrent = []
with ThreadPoolExecutor(max_workers=2) as pool:
    futures = [pool.submit(workflow, i) for i in range(6, 10)]
    for future in as_completed(futures):
        concurrent.append(future.result())
concurrent.sort(key=lambda row: row['index'])
report = {
    'base': BASE,
    'fixture': FIXTURE,
    'sequential': sequential,
    'concurrent': concurrent,
    'summaries': [summarize(sequential, 'sequential'), summarize(concurrent, 'concurrent_2_workers')],
}
Path('/tmp/browser-kit-load-results.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report['summaries'], indent=2))
print(json.dumps({'errors': [row for row in sequential + concurrent if not row['ok']]}, indent=2))
