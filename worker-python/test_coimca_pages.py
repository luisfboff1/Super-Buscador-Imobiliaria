"""Quick test: does Coimca support page=3? And are page=2 links cumulative?"""
from scrapling.fetchers import StealthyFetcher

base = 'www.coimca.com.br'
listing = 'https://www.coimca.com.br/imoveis/vendas/comerciais'

for p in [1, 2, 3]:
    url = listing if p == 1 else f'{listing}?page={p}'
    page = StealthyFetcher.fetch(url, headless=True, network_idle=False, timeout=60000, wait=3000)
    links = set()
    for a in page.css('a[href]'):
        href = a.attrib.get('href', '')
        if href.startswith('/'):
            href = 'https://' + base + href
        if '/imovel/' in href:
            links.add(href)
    print(f'Page {p}: {len(links)} detail links')

# Also check page=2 NEW links vs page=1
print()
print('Testing new links on page 2 vs page 1...')
p1 = StealthyFetcher.fetch(listing, headless=True, network_idle=False, timeout=60000, wait=3000)
p1_links = set()
for a in p1.css('a[href]'):
    href = a.attrib.get('href', '')
    if href.startswith('/'):
        href = 'https://' + base + href
    if '/imovel/' in href:
        p1_links.add(href)

p2 = StealthyFetcher.fetch(f'{listing}?page=2', headless=True, network_idle=False, timeout=60000, wait=3000)
p2_links = set()
for a in p2.css('a[href]'):
    href = a.attrib.get('href', '')
    if href.startswith('/'):
        href = 'https://' + base + href
    if '/imovel/' in href:
        p2_links.add(href)

new_on_p2 = p2_links - p1_links
print(f'Page 1: {len(p1_links)} links')
print(f'Page 2: {len(p2_links)} links (total)')
print(f'New on page 2: {len(new_on_p2)} links')
