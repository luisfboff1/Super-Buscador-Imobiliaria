"""Debug a single property URL to see what extractors find."""
import os, sys

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.logger import setup_logging
setup_logging()

# Test with a buy URL from the site
url = "https://www.bassanesi.com.br/imovel/35804/terreno-para-comprar-com-8080m-maestra-em-caxias-do-sul/"
print(f"\n=== Testando extração: {url} ===\n")

from scrapling.fetchers import Fetcher
from app.crawler import safe_html

page = Fetcher.get(url, stealthy_headers=True, timeout=15)
html = safe_html(page)
print(f"HTML length: {len(html)}")

# Check JSON-LD
from bs4 import BeautifulSoup
import json
soup = BeautifulSoup(html, "lxml")
scripts = soup.find_all("script", type="application/ld+json")
print(f"\nJSON-LD scripts encontrados: {len(scripts)}")
for i, s in enumerate(scripts):
    try:
        data = json.loads(s.string or "")
        print(f"\n  [{i}] @type: {data.get('@type', '?')}")
        print(f"      keys: {list(data.keys())[:10]}")
        if isinstance(data, dict) and data.get("name"):
            print(f"      name: {data['name'][:80]}")
        if isinstance(data, dict) and data.get("offers"):
            print(f"      offers: {data['offers']}")
    except:
        print(f"  [{i}] parse error")

# Check CSS extraction
print(f"\n=== CSS extraction ===")
from app.extractor import extract_from_css, _extract_preco
for tag in soup.find_all(["script", "style", "nav", "footer", "header", "noscript"]):
    tag.decompose()
text = soup.get_text(" ", strip=True).lower()

# Check title
og = soup.find("meta", property="og:title")
print(f"og:title: {og.get('content') if og else 'N/A'}")
h1 = soup.find("h1")
print(f"h1: {h1.get_text(strip=True)[:80] if h1 else 'N/A'}")

# Check price  
import re
matches = re.findall(r"r\$\s*([\d.,]+)", text)
print(f"R$ matches: {matches[:10]}")

preco = _extract_preco(text)
print(f"Preço extraído: {preco}")
