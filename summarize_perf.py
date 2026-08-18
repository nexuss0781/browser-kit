import json
from statistics import mean, median
rows = json.load(open('/tmp/browser-kit-perf-results.json'))
print('action\thttp\tstatus\tms\tok\terror')
for r in rows:
    print(f"{r['action']}\t{r['method']} {r['path']}\t{r['http_status']}\t{r['elapsed_ms']:.3f}\t{r['ok']}\t{r.get('error_code') or r.get('error') or ''}")
values = [r['elapsed_ms'] for r in rows if r['ok']]
values_sorted = sorted(values)
def pct(p):
    return values_sorted[max(0, min(len(values_sorted)-1, int((len(values_sorted)-1)*p)))]
print('\nSUMMARY')
print(json.dumps({
    'total_actions': len(rows),
    'successful_actions': sum(1 for r in rows if r['ok']),
    'failed_or_expected_policy_actions': sum(1 for r in rows if not r['ok']),
    'successful_mean_ms': round(mean(values), 3),
    'successful_median_ms': round(median(values), 3),
    'successful_p95_ms': round(pct(.95), 3),
    'successful_max_ms': round(max(values), 3),
    'total_measured_ms': round(sum(r['elapsed_ms'] for r in rows), 3),
    'workflow_without_fixed_wait_ms': round(sum(r['elapsed_ms'] for r in rows if r['action'] != 'wait_for_search'), 3),
}, indent=2))
