"""Test if Balen has infinite scroll or load more button."""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))

from scrapling import StealthyFetcher
from urllib.parse import urlparse

fetcher = StealthyFetcher()
base = "balenimoveis.imb.br"

def count_links(page):
    links = set()
    for a in page.css("a[href]"):
        try:
            href = a.attrib.get("href", "")
            if not href:
                continue
            if href.startswith("/"):
                href = f"https://{base}{href}"
            parsed = urlparse(href)
            if parsed.hostname and base in parsed.hostname and "/imovel/" in parsed.path:
                links.add(href.split("?")[0].split("#")[0])
        except:
            continue
    return links


# Test 1: Check for "load more" buttons
url = "https://www.balenimoveis.imb.br/imoveis?ordenacao=id"
print(f"Fetching: {url}")
page = fetcher.fetch(url, headless=True, network_idle=False, timeout=60000, wait=3000)
links_before = count_links(page)
print(f"Links before scroll: {len(links_before)}")

# Check for load more / carregar mais buttons
for el in page.css("button, a[href], [role=button], .pagination, .load-more, .btn"):
    try:
        text = (el.text or "").strip()
        if text and len(text) < 100:
            tag = el.tag
            href = el.attrib.get("href", "")
            cls = el.attrib.get("class", "")
            if any(kw in text.lower() for kw in ["mais", "more", "próx", "next", "carregar", "página", "page", "ver todos", "arrow"]):
                print(f"  FOUND: <{tag} class='{cls}' href='{href}'> {text}")
    except:
        continue

# Check for pagination-related elements
for el in page.css(".pagination, nav[aria-label], .pager, [class*=pagin], [class*=pager]"):
    try:
        text = (el.text or "").strip()[:200]
        cls = el.attrib.get("class", "")
        print(f"  PAGINATION ELEMENT: <{el.tag} class='{cls}'> {text[:100]}")
    except:
        continue

# Test 2: Try scrolling
print("\n\nTesting infinite scroll...")
def scroll_action(page_obj):
    """Scroll to bottom multiple times."""
    for i in range(10):
        page_obj.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(2)
        height = page_obj.evaluate("document.body.scrollHeight")
        print(f"  Scroll {i+1}: height={height}")
    time.sleep(3)

page2 = fetcher.fetch(url, headless=True, network_idle=False, timeout=120000, wait=3000,
                       page_action=scroll_action)
if page2:
    links_after = count_links(page2)
    print(f"\nLinks after scroll: {len(links_after)}")
    new = links_after - links_before
    print(f"New links from scroll: {len(new)}")
    for l in sorted(new)[:5]:
        print(f"  {l}")
else:
    print("Scroll fetch failed")


# Test 3: Check if site has API
print("\n\nChecking for API/AJAX patterns in HTML...")
html = str(page.html) if hasattr(page, 'html') else ""
for pattern in ["api/", "/ajax", "loadMore", "nextPage", "fetchMore", "infinite", "scroll"]:
    if pattern.lower() in html.lower():
        # Find context around the pattern
        idx = html.lower().index(pattern.lower())
        context = html[max(0,idx-50):idx+100]
        print(f"  Found '{pattern}': ...{context[:150]}...")
