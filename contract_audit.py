import json
import os
import requests

AUTH = {'Authorization': 'Bearer test-key'}
JSON_HEADERS = {**AUTH, 'Content-Type': 'application/json'}
FIXTURE = 'http://127.0.0.1:18080/workbench.html'

def audit(base):
    def post(path, body=None):
        headers = JSON_HEADERS if body is not None else AUTH
        return requests.post(base + path, headers=headers, json=body, timeout=30)
    created = post('/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowEvaluate': False, 'allowPrivateNetwork': True}})
    sid = created.json()['id']
    view = post(f'/v1/sessions/{sid}/live-view', {'mode': 'readonly', 'ttlSeconds': 60})
    denied = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'evaluate', 'expression': 'document.title'}})
    shot = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'screenshot', 'format': 'png'}})
    shot_body = shot.json()
    data = shot_body.get('data', {}) if isinstance(shot_body, dict) else {}
    artifact = None
    if data.get('artifactUrl'):
        artifact = requests.get(base + data['artifactUrl'], headers=AUTH, timeout=30)
    close1 = post(f'/v1/sessions/{sid}/close')
    close2 = post(f'/v1/sessions/{sid}/close')
    return {
        'live_view_status': view.status_code,
        'live_view_error': view.json().get('error', {}).get('code'),
        'policy_status': denied.status_code,
        'policy_error': denied.json().get('error', {}).get('code'),
        'screenshot_status': shot.status_code,
        'artifact_metadata': bool(data.get('artifactId')),
        'artifact_status': artifact.status_code if artifact else None,
        'close1_status': close1.status_code,
        'close2_status': close2.status_code,
    }

report = {'before': audit(os.environ['BEFORE_BASE']), 'after': audit(os.environ['AFTER_BASE'])}
print(json.dumps(report, indent=2))
