"""Investigate Balen pagination mechanism."""
import sys, os, re, json
sys.path.insert(0, os.path.dirname(__file__))

from scrapling import StealthyFetcher

fetcher = StealthyFetcher()

url = "https://www.balenimoveis.imb.br/imoveis?ordenacao=id"
print(f"Fetching: {url}")
page = fetcher.fetch(url, headless=True, network_idle=False, timeout=60000, wait=5000)

# 1. Check pagination div content
print("\n=== PAGINATION DIV ===")
for el in page.css(".pagination"):
    inner = el.html_content if hasattr(el, 'html_content') else str(el)
    print(f"Pagination HTML ({len(inner)} chars): {inner[:500]}")

# Also check parent
for el in page.css(".pagination"):
    try:
        parent = el.parent
        if parent:
            parent_html = parent.html_content if hasattr(parent, 'html_content') else str(parent)
            print(f"\nParent HTML ({len(parent_html)} chars): {parent_html[:500]}")
    except:
        pass

# 2. Check for __NEXT_DATA__ or similar
print("\n=== EMBEDDED DATA ===")
html = str(page.html) if hasattr(page, 'html') else ""
for pattern in ["__NEXT_DATA__", "window.__data", "window.__STATE", "pageProps", 
                "totalPages", "total_pages", "lastPage", "last_page", "totalCount",
                "imoveis_data", "listings_data", "propertyList"]:
    if pattern in html:
        idx = html.index(pattern)
        context = html[max(0,idx-20):idx+200]
        print(f"  Found '{pattern}': {context[:300]}")

# 3. Check for script tags with pagination info
print("\n=== SCRIPTS WITH PAGINATION ===")
for script in page.css("script"):
    try:
        text = script.text or ""
        if any(kw in text.lower() for kw in ["pagination", "pagina", "page", "total", "imoveis", "imovel"]):
            # Print first 300 chars
            snippet = text[:500].strip()
            if snippet:
                print(f"  Script ({len(text)} chars): {snippet[:300]}...")
    except:
        continue

# 4. Look at the pagination div more carefully with JavaScript 
print("\n=== JS PAGINATION INSPECT ===")
import time

def inspect_pagination(page_obj):
    # Get pagination div content via JS
    result = page_obj.evaluate("""() => {
        const pag = document.querySelector('.pagination');
        if (!pag) return 'NO .pagination element';
        return {
            innerHTML: pag.innerHTML.substring(0, 500),
            childCount: pag.children.length,
            display: getComputedStyle(pag).display,
            visibility: getComputedStyle(pag).visibility,
            classes: pag.className
        };
    }""")
    print(f"  Pagination via JS: {result}")
    
    # Count total /imovel/ links on the page
    result2 = page_obj.evaluate("""() => {
        const links = document.querySelectorAll('a[href*="/imovel/"]');
        return {
            count: links.length,
            first5: Array.from(links).slice(0, 5).map(a => a.href)
        };
    }""")
    print(f"  Detail links via JS: {result2}")
    
    # Check if there's a global state or data
    result3 = page_obj.evaluate("""() => {
        const keys = ['__NEXT_DATA__', '__NUXT__', '__data', '__STATE__', 'pageData'];
        const found = {};
        for (const key of keys) {
            if (window[key]) {
                found[key] = JSON.stringify(window[key]).substring(0, 300);
            }
        }
        return found;
    }""")
    print(f"  Global data: {result3}")

    # Check for Vue/React/Angular
    result4 = page_obj.evaluate("""() => {
        return {
            hasVue: !!window.__VUE__,
            hasReact: !!document.querySelector('[data-reactroot]'),
            hasAngular: !!window.ng || !!document.querySelector('[ng-app]'),
            hasJquery: !!window.jQuery,
        };
    }""")
    print(f"  Frameworks: {result4}")
    
    # Wait and check if pagination renders
    time.sleep(5)
    result5 = page_obj.evaluate("""() => {
        const pag = document.querySelector('.pagination');
        if (!pag) return 'NO .pagination element';
        return {
            innerHTML: pag.innerHTML.substring(0, 500),
            childCount: pag.children.length,
        };
    }""")
    print(f"  Pagination after 5s wait: {result5}")

page2 = fetcher.fetch(url, headless=True, network_idle=False, timeout=60000, wait=3000,
                       page_action=inspect_pagination)
