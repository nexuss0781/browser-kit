import json
import os
import statistics
import time
from pathlib import Path
import requests

BASE = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10009')
FIXTURE = 'http://127.0.0.1:18080/workbench.html'
AUTH = {'Authorization': 'Bearer test-key'}
JSON_HEADERS = {**AUTH, 'Content-Type': 'application/json'}
RUNS = int(os.environ.get('BATCH_RUNS', '10'))
COMMANDS = [
    {'type': 'navigate', 'url': FIXTURE},
    {'type': 'fill', 'selector': '#query', 'value': 'performance'},
    {'type': 'press', 'key': 'Enter'},
    {'type': 'wait', 'selector': '[data-result] article'},
    {'type': 'observe'},
    {'type': 'screenshot', 'format': 'jpeg'},
]

def call(session, method, path, body=None):
    headers = JSON_HEADERS if body is not None else AUTH
    start = time.perf_counter_ns()
    response = session.request(method, BASE + path, headers=headers, json=body, timeout=60)
    elapsed = (time.perf_counter_ns() - start) / 1_000_000
    try:
        payload = response.json()
    except Exception:
        payload = None
    return elapsed, response, payload

def create(session):
    return call(session, 'POST', '/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowPrivateNetwork': True}})

def sequential(session, sid):
    rows = []
    for command in COMMANDS:
        elapsed, response, payload = call(session, 'POST', f'/v1/sessions/{sid}/commands', {'command': command})
        rows.append((elapsed, response, payload))
    return rows

def run(mode, index):
    session = requests.Session()
    create_ms, created_response, created = create(session)
    sid = created['id']
    if mode == 'sequential':
        started = time.perf_counter_ns()
        rows = sequential(session, sid)
        command_ms = (time.perf_counter_ns() - started) / 1_000_000
        successful = all(response.status_code == 200 and payload.get('ok') is not False for _, response, payload in rows)
        result_count = len(rows)
        artifact_metadata = bool(rows[-1][2].get('data', {}).get('artifactId'))
        batch_header = None
    else:
        started = time.perf_counter_ns()
        elapsed, response, payload = call(session, 'POST', f'/v1/sessions/{sid}/commands/batch', {'commands': COMMANDS})
        command_ms = (time.perf_counter_ns() - started) / 1_000_000
        successful = response.status_code == 200 and payload.get('ok') is True and all(result.get('ok') is True for result in payload.get('results', []))
        result_count = len(payload.get('results', []))
        artifact_metadata = bool(payload.get('results', [{}])[-1].get('data', {}).get('artifactId'))
        batch_header = response.headers.get('server-timing')
    close_ms, close_response, _ = call(session, 'POST', f'/v1/sessions/{sid}/close')
    return {'index': index, 'mode': mode, 'create_ms': create_ms, 'command_ms': round(command_ms, 3), 'close_ms': close_ms, 'total_ms': round(create_ms + command_ms + close_ms, 3), 'successful': successful and close_response.status_code == 200, 'result_count': result_count, 'artifact_metadata': artifact_metadata, 'batch_server_timing': batch_header}

report = {'sequential': [run('sequential', i) for i in range(RUNS)], 'batch': [run('batch', i) for i in range(RUNS)]}
for mode, rows in report.items():
    values = [row['total_ms'] for row in rows]
    commands = [row['command_ms'] for row in rows]
    print(json.dumps({
        'mode': mode,
        'runs': len(rows),
        'success': sum(row['successful'] for row in rows),
        'total_mean_ms': round(statistics.mean(values), 3),
        'total_p50_ms': round(statistics.median(values), 3),
        'command_mean_ms': round(statistics.mean(commands), 3),
        'command_p50_ms': round(statistics.median(commands), 3),
        'artifact_metadata_all_runs': all(row['artifact_metadata'] for row in rows),
        'result_count_all_runs': all(row['result_count'] == len(COMMANDS) for row in rows),
    }, indent=2))
Path('/tmp/browser-kit-batch-results.json').write_text(json.dumps(report, indent=2))
