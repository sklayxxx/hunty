#!/usr/bin/env python3
"""Собирает ui/index.html из tools/index.src.html: вставляет спрайт иконок и логотип."""
import re, pathlib
T = pathlib.Path(__file__).parent
src = (T / 'index.src.html').read_text(encoding='utf-8')
sprite = (T / 'sprite.svg.txt').read_text(encoding='utf-8').strip()
LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 1.6v4.6M12 17.8v4.6M1.6 12h4.6M17.8 12h4.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>'
have = set(re.findall(r'<symbol id="i-([a-z0-9-]+)"', sprite))
def icon(m, cls='ic'):
    n = m.group(1)
    assert n in have, 'нет иконки ' + n
    return f'<svg class="{cls}" aria-hidden="true"><use href="#i-{n}"/></svg>'
out = src.replace('{{SPRITE}}', sprite).replace('{{LOGO}}', LOGO)
out = re.sub(r'\{\{I:([a-z0-9-]+)\}\}', icon, out)
out = re.sub(r'\{\{WI:([a-z0-9-]+)\}\}', lambda m: icon(m, 'ic wi'), out)
assert '{{' not in out
(T.parent / 'index.html').write_text(out, encoding='utf-8')
print('index.html', len(out))
