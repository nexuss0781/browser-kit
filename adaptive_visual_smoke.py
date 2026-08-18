import base64
import json
import os
from pathlib import Path
import requests

base = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10015')
out = Path('/tmp/browser-kit-tranche4-adaptive-visual')
out.mkdir(parents=True, exist_ok=True)
headers = {'Authorization': 'Bearer test-key', 'Content-Type': 'application/json'}
fixture = 'http://127.0.0.1:18080/workbench.html'

def post(path, body):
    return requests.post(base + path, headers=headers, json=body, timeout=60)

created = post('/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowPrivateNetwork': True}})
sid = created.json()['id']
post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'navigate', 'url': fixture}})
artifacts = {}
for name, command in {
    'adaptive-fullpage.jpg': {'type': 'screenshot', 'fullPage': True, 'adaptive': True, 'format': 'jpeg', 'quality': 78, 'scale': 'css'},
    'adaptive-clip.webp': {'type': 'screenshot', 'adaptive': True, 'format': 'webp', 'quality': 75, 'clip': {'x': 0, 'y': 0, 'width': 600, 'height': 400}},
    'adaptive.pdf': {'type': 'pdf', 'adaptive': True, 'preferCSSPageSize': True},
}.items():
    response = post(f'/v1/sessions/{sid}/commands', {'command': command})
    payload = response.json()
    data = payload['data']
    path = out / name
    path.write_bytes(base64.b64decode(data['base64']))
    artifacts[name] = {'status': response.status_code, 'mimeType': data['mimeType'], 'bytes': len(base64.b64decode(data['base64'])), 'artifactId': data.get('artifactId')}
close = post(f'/v1/sessions/{sid}/close', {})
report = {'artifacts': artifacts, 'close_status': close.status_code}
(out / 'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
assert close.status_code == 200
