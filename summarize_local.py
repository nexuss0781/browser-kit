import json
from statistics import mean, median
rows = json.load(open('/tmp/browser-kit-local-visual-results.json'))['actions']
values = [r['elapsed_ms'] for r in rows]
ordered = sorted(values)
def pct(p):
    return ordered[max(0, min(len(ordered)-1, int((len(ordered)-1)*p)))]
summary = {
    'total_actions': len(rows),
    'successful_actions': sum(1 for r in rows if r['ok']),
    'failed_actions': sum(1 for r in rows if not r['ok']),
    'mean_ms': round(mean(values), 3),
    'median_ms': round(median(values), 3),
    'p95_ms': round(pct(0.95), 3),
    'max_ms': round(max(values), 3),
    'total_ms': round(sum(values), 3),
}
print(json.dumps(summary, indent=2))
for row in rows:
    print(f"{row['action']}: {row['elapsed_ms']:.3f} ms, http={row['http']}, ok={row['ok']}")
