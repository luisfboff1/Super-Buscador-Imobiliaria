"""Test script to investigate Balen pagination."""
from scrapling.fetchers import StealthyFetcher
import re

page = StealthyFetcher.fetch(
    'https://www.balenimoveis.imb.br/imoveis?ordenacao=id',
    headless=True, network_idle=False, timeout=60000, wait=3000,
)

html = str(page.html_content)

# Search for pagination-related elements in HTML
print('=== PAGINATION IN HTML ===')
for pattern in ['pagination', 'pagina', 'paginacao', 'page-link', 'page-item',
                'next.*page', 'load.*more', 'carregar.*mais', 'ver.*mais',
                'mostrar.*mais', 'infinite', 'scroll']:
    matches = re.findall(r'.{0,80}' + pattern + r'.{0,80}', html, re.I)
    if matches:
        print(f'--- Pattern: {pattern} ({len(matches)} matches) ---')
        for m in matches[:3]:
            print(f'  {m.strip()[:160]}')
        print()

# Check for buttons
print('=== BUTTONS ===')
buttons = page.css('button')
for b in buttons:
    text = ''
    try:
        text = (b.text or '').strip()[:80]
    except:
        pass
    cls = b.attrib.get('class', '')[:80]
    if text or cls:
        print(f'  button class="{cls}" text="{text}"')

# Check for "ver mais" or "carregar mais" or "load more" type elements
print()
print('=== LOAD MORE / VER MAIS ===')
for a in page.css('a[href], button, [onclick]'):
    text = ''
    try:
        text = (a.text or '').strip().lower()[:80]
    except:
        pass
    if any(k in text for k in ['mais', 'more', 'próxim', 'next', 'carregar']):
        href = a.attrib.get('href', '')
        cls = a.attrib.get('class', '')[:50]
        print(f'  <{a.tag}> class="{cls}" href="{href}" text="{text}"')

# Test page 2 with query param
print()
print('=== TEST PAGE 2 URLs ===')
for url in [
    'https://www.balenimoveis.imb.br/imoveis?ordenacao=id&page=2',
    'https://www.balenimoveis.imb.br/imoveis?ordenacao=id&pagina=2',
    'https://www.balenimoveis.imb.br/imoveis?ordenacao=id&pag=2',
    'https://www.balenimoveis.imb.br/imoveis?page=2',
]:
    try:
        p = StealthyFetcher.fetch(url, headless=True, network_idle=False, timeout=60000, wait=3000)
        links = [a for a in p.css('a[href]') if '/imovel/' in a.attrib.get('href', '')]
        print(f'  {url}  -> {len(links)} detail links')
    except Exception as e:
        print(f'  {url}  -> ERROR: {e}')
