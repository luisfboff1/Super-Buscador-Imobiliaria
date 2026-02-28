"""Quick test: verify page_action with scroll works in Scrapling."""
from scrapling.fetchers import StealthyFetcher

async def scroll_test(page):
    """Test scroll action."""
    import asyncio
    # Click "Carregar mais" button
    for i in range(5):
        try:
            btn = page.locator('button:has-text("Carregar mais")').first
            if await btn.is_visible(timeout=1000):
                await btn.click()
                print(f"  Click {i+1}: clicked 'Carregar mais'")
                await asyncio.sleep(2)
            else:
                print(f"  Click {i+1}: button not visible")
                break
        except Exception as e:
            print(f"  Click {i+1}: error - {e}")
            break

print("=== Testing page_action scroll on Coimca ===")
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

print(f"Detail links after scroll: {len(detail_urls)}")
