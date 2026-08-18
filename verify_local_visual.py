import json
from pathlib import Path
from PIL import Image
from pypdf import PdfReader

root = Path('/tmp/browser-kit-local-visual')
results = json.loads(Path('/tmp/browser-kit-local-visual-results.json').read_text())
expected_actions = [
    'create_session', 'navigate_workbench', 'observe_ready', 'fill_query',
    'press_enter', 'wait_results', 'observe_results', 'click_result',
    'hover_target', 'fill_contenteditable', 'scroll_page', 'reload_page',
    'back_history', 'forward_history', 'evaluate_policy_denied',
    'screenshot_results', 'screenshot_viewport', 'pdf', 'close_session'
]
actual_actions = [row['action'] for row in results['actions']]
assert actual_actions == expected_actions, (actual_actions, expected_actions)
assert all(row['ok'] for row in results['actions'] if row['action'] != 'evaluate_policy_denied')
policy = next(row for row in results['actions'] if row['action'] == 'evaluate_policy_denied')
assert policy['http'] == 403 and policy.get('error_code') == 'POLICY_DENIED', policy
assert 'Browser Kit Performance' in json.dumps(results['observed'])

png = Image.open(root / '01-local-results.png')
jpg = Image.open(root / '02-local-viewport.jpg')
assert png.size[0] == 1440 and png.size[1] > 900, png.size
assert jpg.size == (1440, 900), jpg.size
assert png.getbbox() is not None
assert jpg.getbbox() is not None
pdf_pages = len(PdfReader(str(root / '03-local-results.pdf')).pages)
assert pdf_pages == 2, pdf_pages

print(json.dumps({
    'actions_verified': len(actual_actions),
    'all_expected_actions_passed': True,
    'png_dimensions': png.size,
    'jpeg_dimensions': jpg.size,
    'pdf_pages': pdf_pages,
    'expected_result_text_verified': True,
}, indent=2))
