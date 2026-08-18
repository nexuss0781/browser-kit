import concurrent.futures
import json
import os
import time
import requests

base = os.environ.get('BROWSER_KIT_BASE', 'http://127.0.0.1:10013')
headers = {'Authorization': 'Bearer test-key', 'Content-Type': 'application/json'}
fixture = 'http://127.0.0.1:18080/workbench.html'

def post(path, body=None, timeout=60):
    return requests.post(base + path, headers=headers, json=body, timeout=timeout)

created = post('/v1/sessions', {'ttlSeconds': 120, 'policy': {'allowPrivateNetwork': True}})
sid = created.json()['id']
post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'navigate', 'url': fixture}})
adaptive = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'screenshot', 'fullPage': True, 'adaptive': True, 'format': 'jpeg', 'quality': 72, 'scale': 'css'}})
clipped = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'screenshot', 'adaptive': True, 'format': 'webp', 'clip': {'x': 0, 'y': 0, 'width': 500, 'height': 300}}})
adaptive_pdf = post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'pdf', 'adaptive': True, 'preferCSSPageSize': True}})

def slow_wait(_):
    return post(f'/v1/sessions/{sid}/commands', {'command': {'type': 'wait', 'ms': 250}}, timeout=60)

started = time.perf_counter()
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    responses = list(pool.map(slow_wait, range(40)))
queue_ms = (time.perf_counter() - started) * 1000
close = post(f'/v1/sessions/{sid}/close', {})

adaptive_data = adaptive.json().get('data', {})
clipped_data = clipped.json().get('data', {})
pdf_data = adaptive_pdf.json().get('data', {})
report = {
    'adaptive_status': adaptive.status_code,
    'adaptive_mime': adaptive_data.get('mimeType'),
    'adaptive_format': adaptive_data.get('format'),
    'adaptive_artifact': bool(adaptive_data.get('artifactId')),
    'clipped_status': clipped.status_code,
    'clipped_mime': clipped_data.get('mimeType'),
    'clipped_artifact': bool(clipped_data.get('artifactId')),
    'adaptive_pdf_status': adaptive_pdf.status_code,
    'adaptive_pdf_mime': pdf_data.get('mimeType'),
    'adaptive_pdf_artifact': bool(pdf_data.get('artifactId')),
    'queue_elapsed_ms': round(queue_ms, 3),
    'queue_status_counts': {str(status): sum(response.status_code == status for response in responses) for status in sorted({response.status_code for response in responses})},
    'queue_error_codes': sorted({response.json().get('error', {}).get('code') for response in responses if response.status_code >= 400}),
    'close_status': close.status_code,
}
print(json.dumps(report, indent=2))
assert adaptive.status_code == 200 and adaptive_data.get('mimeType') == 'image/jpeg' and adaptive_data.get('artifactId')
assert clipped.status_code == 200 and clipped_data.get('mimeType') == 'image/webp' and clipped_data.get('artifactId')
assert adaptive_pdf.status_code == 200 and adaptive_pdf.json().get('data', {}).get('mimeType') == 'application/pdf'
assert close.status_code == 200
