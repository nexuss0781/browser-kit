import json
from pathlib import Path

current = json.loads(Path('/tmp/browser-kit-before-after-audit.json').read_text())['versions']['after']['summary']
old = {}
for line in Path('/tmp/browser-kit-before-after-table.txt').read_text().splitlines():
    if '\t' not in line or line.startswith('action') or line == 'workflow':
        continue
    name, before, after, delta, *_ = line.split('\t')
    old[name] = {'before': float(before), 'after': float(after)}
print('action\toriginal_before_ms\tprevious_after_ms\toptimized_after_ms\toptimization_delta_ms')
for name, row in current['actions'].items():
    previous = old.get(name, {}).get('after')
    optimized = row['mean_ms']
    print(f"{name}\t{old.get(name, {}).get('before', 'n/a')}\t{previous if previous is not None else 'n/a'}\t{optimized:.3f}\t{optimized-previous:+.3f}" if previous is not None else f"{name}\tn/a\tn/a\t{optimized:.3f}\tn/a")
previous_workflow = 635.297
optimized_workflow = current['workflow']['mean_ms']
print('\nworkflow')
print(json.dumps({'previous_after_mean_ms': previous_workflow, 'optimized_after_mean_ms': optimized_workflow, 'delta_ms': round(optimized_workflow - previous_workflow, 3), 'optimized_p95_ms': current['workflow']['p95_ms'], 'success_runs': current['workflow']['success_runs']}, indent=2))
