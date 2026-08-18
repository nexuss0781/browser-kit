import json
import os
import time
import requests

base = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10011')
headers = {'Authorization': 'Bearer test-key', 'Content-Type': 'application/json'}
fixture = 'http://127.0.0.1:18080/workbench.html'

def post(path, body=None):
    return requests.post(base + path, headers=headers, json=body, timeout=30)

started = time.perf_counter_ns()
created = post('/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowPrivateNetwork': True}})
create_ms = (time.perf_counter_ns() - started) / 1_000_000
sid = created.json()['id']
navigate = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'navigate', 'url': fixture}})
observed = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'observe'}})
ref = observed.json()['data']['elements'][0]['ref']
again = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'navigate', 'url': fixture}})
stale = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'click', 'ref': ref}})
selector = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'click', 'selector': '#query'}})
close = post(f'/v1/sessions/{sid}/close', {})
report = {
    'create_ms': round(create_ms, 3),
    'create_status': created.status_code,
    'navigate_status': navigate.status_code,
    'observe_status': observed.status_code,
    'stale_status': stale.status_code,
    'stale_code': stale.json().get('error', {}).get('code'),
    'selector_status': selector.status_code,
    'selector_ok': selector.json().get('ok'),
    'close_status': close.status_code,
}
print(json.dumps(report, indent=2))
assert created.status_code == 201
assert observed.status_code == 200
assert stale.status_code == 409 and stale.json()['error']['code'] == 'STALE_OBSERVATION'
assert selector.status_code == 200 and selector.json()['ok'] is True
assert close.status_code == 200
