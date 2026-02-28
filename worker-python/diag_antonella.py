"""Diagnostic: what does Playwright see on Antonella?"""
import re
from scrapling.fetchers import StealthyFetcher

url = "https://www.antonellaimoveis.com.br/imoveis/venda/-/-/-/-"
base = "www.antonellaimoveis.com.br"

print("Fetching with Playwright...")
page = StealthyFetcher.fetch(url, headless=True, network_idle=True, timeout=30000)
html = str(page.html_content)
print(f"HTML length: {len(html)}")

# Card classes
for pat in ["card", "imovel", "property", "listing", "resultado"]:
    count = len(re.findall(rf'class="[^"]*{pat}[^"]*"', html, re.I))
    if count:
        print(f'class "{pat}": {count}')

# All <a> tags
all_a = page.css("a[href]")
print(f"\nTotal <a> tags: {len(all_a)}")

# Deep links (many path segments)
for a in all_a:
    h = a.attrib.get("href", "")
    text = (a.text or "").strip()[:60]
    if h.startswith("/"):
        h = f"https://{base}{h}"
    if "/imoveis/" in h and h.count("/") >= 7:
        print(f"  DEEP: {h}  [{text}]")

# SPA patterns
print(f"\nonClick mentions: {len(re.findall('onClick', html))}")
print(f"data-href/url: {len(re.findall('data-(href|url)', html))}")

# /imovel/ (singular) links
detail = re.findall(r'href="(/imovel/[^"]+)"', html)
if detail:
    print(f"\n/imovel/ links: {len(detail)}")
    for d in detail[:10]:
        print(f"  {d}")

# Prices
prices = re.findall(r'R\$\s*[\d.,]+', html)
print(f"\nPrices: {len(prices)}")
for p in prices[:5]:
    print(f"  {p}")

# Dump HTML around property cards (look for anchor-less property refs)
# Check for Next.js JSON data
json_data = re.findall(r'__NEXT_DATA__[^{]*({.*?})</script>', html, re.S)
if json_data:
    print(f"\n__NEXT_DATA__ found: {len(json_data[0])} chars")
    # Look for property URLs in JSON
    prop_urls = re.findall(r'"url":"(/[^"]+)"', json_data[0])
    print(f"URLs in NEXT_DATA: {len(prop_urls)}")
    for u in prop_urls[:10]:
        print(f"  {u}")

# Check for any link-like structure with /imovel/ in HTML 
imovel_refs = re.findall(r'/imovel[^"\'>\s]{5,60}', html)
if imovel_refs:
    print(f"\n/imovel references in HTML: {len(imovel_refs)}")
    for r_ in list(set(imovel_refs))[:15]:
        print(f"  {r_}")
