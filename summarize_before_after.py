import json
from pathlib import Path

data = json.loads(Path('/tmp/browser-kit-before-after-audit.json').read_text())['versions']
before = data['before']['summary']
after = data['after']['summary']
print('action\tbefore_mean_ms\tafter_mean_ms\tdelta_ms\tbefore_success\tafter_success')
for name in before['actions']:
    b = before['actions'][name]
    a = after['actions'][name]
    print(f"{name}\t{b['mean_ms']:.3f}\t{a['mean_ms']:.3f}\t{a['mean_ms']-b['mean_ms']:+.3f}\t{b['success_runs']}/{data['before']['summary']['runs']}\t{a['success_runs']}/{data['after']['summary']['runs']}")
print('\nworkflow')
for version in ('before', 'after'):
    w = data[version]['summary']['workflow']
    print(version, json.dumps(w))
