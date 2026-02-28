"""Test script to investigate Coimca pagination/infinite scroll."""
from scrapling.fetchers import StealthyFetcher
import re

# Fetch listing page
print('=== COIMCA /imoveis/vendas/comerciais ===')
page = StealthyFetcher.fetch(
    'https://www.coimca.com.br/imoveis/vendas/comerciais',
    headless=True, network_idle=False, timeout=60000, wait=3000,
)
print('Status:', page.status)
print('Final URL:', getattr(page, 'url', 'N/A'))

base = 'www.coimca.com.br'
all_links = page.css('a[href]')
detail_urls = set()
for a in all_links:
    href = a.attrib.get('href', '')
    if href.startswith('/'):
        href = 'https://' + base + href
    if '/imovel/' in href:
        detail_urls.add(href)

print('Detail links:', len(detail_urls))

# Check for infinite scroll indicators
html = str(page.html_content)
print()
print('=== INFINITE SCROLL INDICATORS ===')
for pattern in ['infinite', 'scroll', 'load.*more', 'carregar.*mais', 
                'ver.*mais', 'mostrar.*mais', 'lazy', 'observer',
                'IntersectionObserver', 'loadMore', 'nextPage']:
    matches = re.findall(r'.{0,60}' + pattern + r'.{0,60}', html, re.I)
    if matches:
        print(f'--- {pattern} ({len(matches)} matches) ---')
        for m in matches[:3]:
            clean = m.strip()[:160]
            print(f'  {clean}')
        print()

# Test page 2 with query params
print()
print('=== TEST PAGE 2 URLs ===')
for url in [
    'https://www.coimca.com.br/imoveis/vendas/comerciais?page=2',
    'https://www.coimca.com.br/imoveis/vendas/comerciais?pagina=2',
    'https://www.coimca.com.br/imoveis/vendas/comerciais/2',
]:
    try:
        p = StealthyFetcher.fetch(url, headless=True, network_idle=False, timeout=60000, wait=3000)
        links = [a for a in p.css('a[href]') if '/imovel/' in a.attrib.get('href', '')]
        final = getattr(p, 'url', url)
        print(f'  {url}  -> {len(links)} detail links (final: {final})')
    except Exception as e:
        print(f'  {url}  -> ERROR: {e}')

# Also fetch the main /imoveis page to see what the crawler sees first
print()
print('=== COIMCA HOMEPAGE /imoveis ===')
page2 = StealthyFetcher.fetch(
    'https://www.coimca.com.br/',
    headless=True, network_idle=False, timeout=60000, wait=3000,
)
links = page2.css('a[href]')
relevant = []
seen = set()
for a in links:
    href = a.attrib.get('href', '')
    if href.startswith('/'):
        href = 'https://' + base + href
    if not href.startswith('http'):
        continue
    if href in seen:
        continue
    seen.add(href)
    text = ''
    try:
        text = (a.text or '').strip()[:60]
    except:
        pass
    if text or any(k in href.lower() for k in ['imov', 'comprar', 'venda', 'alug']):
        relevant.append(f'{href}  ({text})')

print(f'Relevant homepage links: {len(relevant)}')
for l in relevant[:40]:
    print(l)
