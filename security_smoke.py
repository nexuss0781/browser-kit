import json
import os
import requests

base = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10002')
auth = {'Authorization': 'Bearer test-key'}
json_headers = {**auth, 'Content-Type': 'application/json'}

def post(path, body=None):
    headers = json_headers if body is not None else auth
    return requests.post(base + path, headers=headers, json=body, timeout=30)

created = post('/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowEvaluate': False}})
sid = created.json()['id']
blocked = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'navigate', 'url': 'http://127.0.0.1:18080/workbench.html'}})
closed = post(f'/v1/sessions/{sid}/close')

created_allowed = post('/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowEvaluate': False, 'allowPrivateNetwork': True}})
sid_allowed = created_allowed.json()['id']
allowed = post(f'/v1/sessions/{sid_allowed}/commands', {'command': {'type': 'navigate', 'url': 'http://127.0.0.1:18080/workbench.html'}})
closed_allowed = post(f'/v1/sessions/{sid_allowed}/close')

report = {
    'blocked_status': blocked.status_code,
    'blocked_body': blocked.json(),
    'blocked_session_close': closed.status_code,
    'allowed_status': allowed.status_code,
    'allowed_body': allowed.json(),
    'allowed_session_close': closed_allowed.status_code,
}
print(json.dumps(report, indent=2))
assert blocked.status_code == 403
assert blocked.json()['error']['code'] == 'POLICY_DENIED'
assert allowed.status_code == 200 and allowed.json()['ok'] is True
assert closed.status_code == 200 and closed_allowed.status_code == 200
