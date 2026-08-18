import json
import os
import requests

base = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10009')
auth = {'Authorization': 'Bearer test-key'}
headers = {**auth, 'Content-Type': 'application/json'}

def post(path, body):
    return requests.post(base + path, headers=headers, json=body, timeout=30)

created = post('/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowEvaluate': False, 'allowPrivateNetwork': True}})
sid = created.json()['id']
commands = [
    {'type': 'navigate', 'url': 'http://127.0.0.1:18080/workbench.html'},
    {'type': 'evaluate', 'expression': 'document.title'},
    {'type': 'observe'},
]
stopped = post(f'/v1/sessions/{sid}/commands/batch', {'commands': commands})
continued = post(f'/v1/sessions/{sid}/commands/batch', {'commands': commands, 'continueOnError': True})
close = post(f'/v1/sessions/{sid}/close', {})
report = {
    'stopped_status': stopped.status_code,
    'stopped_ok': stopped.json().get('ok'),
    'stopped_completed': stopped.json().get('completed'),
    'stopped_failed': stopped.json().get('failed'),
    'continued_status': continued.status_code,
    'continued_ok': continued.json().get('ok'),
    'continued_completed': continued.json().get('completed'),
    'continued_failed': continued.json().get('failed'),
    'close_status': close.status_code,
}
print(json.dumps(report, indent=2))
assert stopped.status_code == 200 and stopped.json()['ok'] is False and stopped.json()['completed'] == 2 and stopped.json()['failed'] == 1
assert continued.status_code == 200 and continued.json()['ok'] is False and continued.json()['completed'] == 3 and continued.json()['failed'] == 1
assert close.status_code == 200
