"""Test sync page_action scroll on Coimca."""
from scrapling.fetchers import StealthyFetcher
import time

def scroll_test(page):
    """Sync scroll action."""
    for i in range(10):
        try:
            btn = page.locator('button:has-text("Carregar mais")').first
            if btn.is_visible(timeout=1000):
                btn.click()
                print(f"  Click {i+1}: clicked 'Carregar mais'")
                time.sleep(2)
            else:
                print(f"  Click {i+1}: button not visible, stopping")
                break
        except Exception as e:
            print(f"  Click {i+1}: error - {type(e).__name__}: {e}")
            break

print("=== Testing SYNC page_action scroll on Coimca ===")
page = StealthyFetcher.fetch(
    'https://www.coimca.com.br/imoveis/vendas/comerciais',
    headless=True,
    network_idle=False,
    timeout=120000,
    wait=3000,
    disable_resources=False,
    page_action=scroll_test,
)

base = 'www.coimca.com.br'
detail_urls = set()
for a in page.css('a[href]'):
    href = a.attrib.get('href', '')
    if href.startswith('/'):
        href = 'https://' + base + href
    if '/imovel/' in href:
        detail_urls.add(href)

print(f"\nDetail links after scroll: {len(detail_urls)}")
