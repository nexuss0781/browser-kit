import base64
import json
import os
import requests

base = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10003')
auth = {'Authorization': 'Bearer test-key'}
headers = {**auth, 'Content-Type': 'application/json'}

def post(path, body):
    return requests.post(base + path, headers=headers, json=body, timeout=30)

created = post('/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowPrivateNetwork': True}})
sid = created.json()['id']
post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'navigate', 'url': 'http://127.0.0.1:18080/workbench.html'}})
shot = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'screenshot', 'format': 'png'}})
payload = shot.json()
data = payload['data']
artifact_id = data['artifactId']
artifact = requests.get(base + data['artifactUrl'], headers=auth, timeout=30)
close = requests.post(f'{base}/v1/sessions/{sid}/close', headers=auth, timeout=30)
report = {
    'command_status': shot.status_code,
    'artifact_id_present': bool(artifact_id),
    'artifact_url': data['artifactUrl'],
    'artifact_mime': artifact.headers.get('content-type'),
    'artifact_status': artifact.status_code,
    'artifact_bytes': len(artifact.content),
    'inline_bytes': len(base64.b64decode(data['base64'])),
    'close_status': close.status_code,
}
print(json.dumps(report, indent=2))
assert shot.status_code == 200 and payload['ok'] is True
assert artifact_id and artifact.status_code == 200
assert artifact.headers.get('content-type', '').startswith('image/png')
assert len(artifact.content) == len(base64.b64decode(data['base64']))
assert close.status_code == 200
