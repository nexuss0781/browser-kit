import json
from pathlib import Path
p = json.loads(Path('/tmp/browser-kit-before-after-audit.json').read_text())['versions']
b = p['before']['summary']
a = p['after']['summary']
print('action\tprevious_after_mean_ms\toptimized_mean_ms\tdelta_ms\tprevious_p95_ms\toptimized_p95_ms')
for name in b['actions']:
    x, y = b['actions'][name], a['actions'][name]
    print(f"{name}\t{x['mean_ms']:.3f}\t{y['mean_ms']:.3f}\t{y['mean_ms']-x['mean_ms']:+.3f}\t{x['p95_ms']:.3f}\t{y['p95_ms']:.3f}")
print('\nworkflow')
for version, summary in [('previous_after', b), ('optimized', a)]:
    print(version, json.dumps(summary['workflow']))
