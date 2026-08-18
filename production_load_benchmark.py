import concurrent.futures
import json
import os
import statistics
import time
from collections import Counter
import requests

BASE = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10013')
AUTH = {'Authorization': 'Bearer test-key'}
JSON_HEADERS = {**AUTH, 'Content-Type': 'application/json'}
FIXTURE = 'http://127.0.0.1:18080/workbench.html'
SEQUENTIAL = int(os.environ.get('SEQUENTIAL_RUNS', '30'))
CONCURRENT = int(os.environ.get('CONCURRENT_RUNS', '10'))
WORKERS = int(os.environ.get('CONCURRENT_WORKERS', '4'))
COMMANDS = [
    {'type': 'navigate', 'url': FIXTURE},
    {'type': 'fill', 'selector': '#query', 'value': 'performance'},
    {'type': 'press', 'key': 'Enter'},
    {'type': 'wait', 'selector': '[data-result] article'},
    {'type': 'observe'},
    {'type': 'screenshot', 'adaptive': True, 'format': 'jpeg', 'quality': 78, 'scale': 'css'},
]

def pct(values, p):
    if not values: return 0.0
    values = sorted(values)
    index = min(len(values) - 1, max(0, int(round((p / 100) * (len(values) - 1)))))
    return round(values[index], 3)

def request(session, method, path, body=None):
    headers = JSON_HEADERS if body is not None else AUTH
    return session.request(method, BASE + path, headers=headers, json=body, timeout=60)

def workflow(index):
    session = requests.Session()
    started = time.perf_counter_ns()
    failures = []
    try:
        created = request(session, 'POST', '/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowPrivateNetwork': True}})
        if created.status_code != 201:
            failures.append(f'create:{created.status_code}')
            return {'index': index, 'ok': False, 'elapsed_ms': (time.perf_counter_ns() - started) / 1_000_000, 'failures': failures}
        sid = created.json()['id']
        for command in COMMANDS:
            response = request(session, 'POST', f'/v1/sessions/{sid}/commands', {'command': command})
            payload = response.json()
            if response.status_code != 200 or payload.get('ok') is False:
                failures.append(f"{command['type']}:{response.status_code}:{payload.get('error', {}).get('code', 'UNKNOWN')}")
                break
        closed = request(session, 'POST', f'/v1/sessions/{sid}/close', {})
        if closed.status_code != 200: failures.append(f'close:{closed.status_code}')
    except Exception as exc:
        failures.append(type(exc).__name__)
    return {'index': index, 'ok': not failures, 'elapsed_ms': round((time.perf_counter_ns() - started) / 1_000_000, 3), 'failures': failures}

def summarize(rows, label):
    values = [row['elapsed_ms'] for row in rows]
    failures = Counter(item for row in rows for item in row['failures'])
    return {
        'label': label,
        'runs': len(rows),
        'success': sum(row['ok'] for row in rows),
        'failure_count': len(rows) - sum(row['ok'] for row in rows),
        'mean_ms': round(statistics.mean(values), 3) if values else 0,
        'p50_ms': pct(values, 50),
        'p95_ms': pct(values, 95),
        'p99_ms': pct(values, 99),
        'max_ms': round(max(values), 3) if values else 0,
        'failure_taxonomy': dict(failures),
    }

sequential = [workflow(i) for i in range(SEQUENTIAL)]
with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
    concurrent_rows = list(pool.map(workflow, range(CONCURRENT)))
report = {'sequential': summarize(sequential, 'sequential'), 'concurrent': summarize(concurrent_rows, f'concurrent_{WORKERS}_workers'), 'rows': {'sequential': sequential, 'concurrent': concurrent_rows}}
print(json.dumps(report['sequential'], indent=2))
print(json.dumps(report['concurrent'], indent=2))
with open('/tmp/browser-kit-production-load.json', 'w') as handle:
    json.dump(report, handle, indent=2)
assert report['sequential']['success'] == SEQUENTIAL
assert report['concurrent']['success'] == CONCURRENT
