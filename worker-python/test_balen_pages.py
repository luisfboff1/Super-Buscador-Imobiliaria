"""Test Balen pagination to understand why pages 3+ return 0 new."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from scrapling import StealthyFetcher
from urllib.parse import urlparse

fetcher = StealthyFetcher()
base = "balenimoveis.imb.br"

def get_links(url):
    """Fetch page and extract detail links."""
    print(f"\nFetching: {url}")
    page = fetcher.fetch(url, headless=True, network_idle=False, timeout=60000, wait=3000)
    if not page:
        print("  NO RESPONSE")
        return set()
    
    final_url = getattr(page, 'url', url) or url
    print(f"  Final URL: {final_url}")
    
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
    print(f"  Detail links: {len(links)}")
    return links


# Test different listing URLs and their pages
urls_to_test = [
    ("Page 1 (no params)", "https://www.balenimoveis.imb.br/imoveis"),
    ("Page 1 (ordenacao)", "https://www.balenimoveis.imb.br/imoveis?ordenacao=id"),
    ("Page 2 (no ord)", "https://www.balenimoveis.imb.br/imoveis?page=2"),
    ("Page 2 (with ord)", "https://www.balenimoveis.imb.br/imoveis?ordenacao=id&page=2"),
    ("Page 3 (no ord)", "https://www.balenimoveis.imb.br/imoveis?page=3"),
    ("Page 3 (with ord)", "https://www.balenimoveis.imb.br/imoveis?ordenacao=id&page=3"),
    ("Page 5 (with ord)", "https://www.balenimoveis.imb.br/imoveis?ordenacao=id&page=5"),
    ("Page 10 (with ord)", "https://www.balenimoveis.imb.br/imoveis?ordenacao=id&page=10"),
]

all_links = {}
for label, url in urls_to_test:
    links = get_links(url)
    all_links[label] = links
    for l in sorted(links)[:3]:
        print(f"    {l}")
    if len(links) > 3:
        print(f"    ... +{len(links) - 3} more")

print("\n\n=== OVERLAP ANALYSIS ===")
p1 = all_links.get("Page 1 (no params)", set())
p1_ord = all_links.get("Page 1 (ordenacao)", set())
p2 = all_links.get("Page 2 (no ord)", set())
p2_ord = all_links.get("Page 2 (with ord)", set())
p3 = all_links.get("Page 3 (no ord)", set())
p3_ord = all_links.get("Page 3 (with ord)", set())

print(f"\nPage 1 vs Page 1 (ord): {len(p1 & p1_ord)} overlap, {len(p1 - p1_ord)} only in p1, {len(p1_ord - p1)} only in p1_ord")
print(f"Page 1 vs Page 2: {len(p1 & p2)} overlap")
print(f"Page 1 vs Page 2 (ord): {len(p1 & p2_ord)} overlap")  
print(f"Page 1 (ord) vs Page 2 (ord): {len(p1_ord & p2_ord)} overlap")
print(f"Page 1 vs Page 3: {len(p1 & p3)} overlap")
print(f"Page 1 (ord) vs Page 3 (ord): {len(p1_ord & p3_ord)} overlap")
print(f"Page 2 vs Page 3: {len(p2 & p3)} overlap")
print(f"Page 2 (ord) vs Page 3 (ord): {len(p2_ord & p3_ord)} overlap")

# Total unique across pages 1-5 with ord
total = p1_ord | p2_ord | p3_ord | all_links.get("Page 5 (with ord)", set()) | all_links.get("Page 10 (with ord)", set())
print(f"\nTotal unique (p1+p2+p3+p5+p10 with ord): {len(total)}")
