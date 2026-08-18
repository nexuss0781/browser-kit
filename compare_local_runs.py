import json
from pathlib import Path

current = json.loads(Path('/tmp/browser-kit-local-visual-results.json').read_text())['actions']
old_path = Path('/tmp/browser-kit-local-visual-summary.txt')
old_lines = old_path.read_text().splitlines() if old_path.exists() else []
old = {}
for line in old_lines:
    if ': ' in line and line.split(':', 1)[0] not in ('{', '}'):
        name, rest = line.split(': ', 1)
        try:
            old[name] = float(rest.split(' ms', 1)[0])
        except ValueError:
            pass
print('action\tcurrent_ms\tprevious_ms\tdelta_ms')
for row in current:
    name = row['action']
    previous = old.get(name)
    delta = round(row['elapsed_ms'] - previous, 3) if previous is not None else None
    print(f"{name}\t{row['elapsed_ms']:.3f}\t{previous if previous is not None else 'n/a'}\t{delta if delta is not None else 'n/a'}")
print('\nTiming headers verified:', sum('server_timing' in row for row in current), 'of', len(current)-2, 'browser commands')
print('All command timing payloads verified:', all('command_timings' in row for row in current if row['action'] not in ('create_session', 'close_session')))
