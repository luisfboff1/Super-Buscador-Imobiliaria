"""Test Balen JS pagination by clicking page buttons."""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))

from scrapling import StealthyFetcher
from urllib.parse import urlparse

fetcher = StealthyFetcher()
base = "balenimoveis.imb.br"

url = "https://www.balenimoveis.imb.br/imoveis?ordenacao=id"

all_links = set()

def click_pages(page_obj):
    """Click through pagination buttons to load all pages."""
    
    def get_links():
        return page_obj.evaluate("""() => {
            const links = new Set();
            document.querySelectorAll('a[href]').forEach(a => {
                const href = a.href;
                if (href.includes('/imovel/') && !href.includes('?')) {
                    links.add(href.split('#')[0]);
                }
            });
            return Array.from(links);
        }""")
    
    # Get page 1 links
    time.sleep(2)
    links = get_links()
    for l in links:
        all_links.add(l)
    print(f"Page 1: {len(links)} links (total: {len(all_links)})")
    
    # Click through pages
    for page_num in range(2, 30):
        # Find and click the page button
        clicked = page_obj.evaluate(f"""(pageNum) => {{
            const pagination = document.querySelector('#pagination');
            if (!pagination) return 'no pagination element';
            const links = pagination.querySelectorAll('a');
            for (const a of links) {{
                const text = a.textContent.trim();
                if (text === String(pageNum)) {{
                    a.click();
                    return 'clicked ' + pageNum;
                }}
            }}
            // Try next arrow
            const arrows = pagination.querySelectorAll('a');
            const lastArrow = arrows[arrows.length - 1];
            if (lastArrow && lastArrow.textContent.includes('»')) {{
                // Check if it's disabled
                if (lastArrow.classList.contains('disabled')) return 'last page reached';
            }}
            return 'page button not found: ' + pageNum;
        }}""", page_num)
        
        if 'not found' in str(clicked) or 'last page' in str(clicked):
            print(f"  Stop: {clicked}")
            break
        
        # Wait for content to update
        time.sleep(2)
        
        links = get_links()
        new_links = [l for l in links if l not in all_links]
        for l in links:
            all_links.add(l)
        print(f"Page {page_num}: {len(links)} links, +{len(new_links)} new (total: {len(all_links)})")
        
        if len(new_links) == 0:
            # Maybe need to scroll up to see results
            page_obj.evaluate("window.scrollTo(0, 0)")
            time.sleep(1)
            links2 = get_links()
            new2 = [l for l in links2 if l not in all_links]
            if not new2:
                print(f"  WARNING: No new links on page {page_num}")
                # Don't stop yet - might be a glitch

print(f"Fetching: {url}")
page = fetcher.fetch(url, headless=True, network_idle=False, timeout=120000, wait=5000,
                     page_action=click_pages)

print(f"\n=== FINAL ===")
print(f"Total unique links: {len(all_links)}")
for l in sorted(all_links)[:5]:
    print(f"  {l}")
print(f"  ... +{max(0, len(all_links) - 5)} more")
