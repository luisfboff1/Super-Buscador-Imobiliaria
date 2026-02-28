"""
Diagnóstico focado: testar se o fluxo de paginação funciona para Antonella.
1. Fetch listing page com Playwright
2. Extract detail links (page 1)
3. Detect pagination buttons 
4. Probe pagination=2 e verificar se URLs são diferentes
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.crawler import (
    fetch_page, extract_detail_links, _find_pagination_in_dom,
    _detect_page2_url, _url_to_template, is_detail_page_url
)
from scrapling.fetchers import StealthyFetcher

LISTING_URL = "https://www.antonellaimoveis.com.br/imoveis/venda/-/-/-"
BASE_HOSTNAME = "www.antonellaimoveis.com.br"

print(f"=== STEP 1: Fetch listing com Playwright (disable_resources=False) ===")
page = fetch_page(LISTING_URL, stealth=True)
if not page:
    print("ERRO: Sem resposta!")
    exit(1)
print(f"OK - page fetched")

print(f"\n=== STEP 2: Extract detail links (page 1) ===")
links_p1 = extract_detail_links(page, BASE_HOSTNAME)
print(f"Detail links encontrados: {len(links_p1)}")
for l in links_p1[:5]:
    print(f"  {l}")

print(f"\n=== STEP 3: _find_pagination_in_dom ===")
dom_result = _find_pagination_in_dom(page, LISTING_URL, BASE_HOSTNAME)
print(f"Resultado: {dom_result}")

if dom_result:
    dom_url, dom_page_num = dom_result
    if dom_url == "__BUTTON_PAGINATION__":
        print(f"  → Paginação via BUTTON detectada, max_page={dom_page_num}")
        
        # Test each pagination param
        print(f"\n=== STEP 4: Probing pagination params ===")
        for param in ["pagination", "page", "pagina", "pag"]:
            sep = "&" if "?" in LISTING_URL else "?"
            probe_url = f"{LISTING_URL}{sep}{param}=2"
            print(f"\n  Probing: {probe_url}")
            p2 = fetch_page(probe_url, stealth=True)
            if p2:
                links_p2 = extract_detail_links(p2, BASE_HOSTNAME)
                print(f"    Detail links: {len(links_p2)}")
                if links_p2:
                    # Check if different from page 1
                    new_links = [l for l in links_p2 if l not in links_p1]
                    print(f"    NEW links (not in page 1): {len(new_links)}")
                    for l in new_links[:3]:
                        print(f"      {l}")
                    
                    if new_links:
                        print(f"\n  ✓ {param}=2 FUNCIONA! Achando URLs diferentes na pág 2")
                        
                        # Test page 3 too
                        probe_p3 = f"{LISTING_URL}{sep}{param}=3"
                        p3 = fetch_page(probe_p3, stealth=True)
                        if p3:
                            links_p3 = extract_detail_links(p3, BASE_HOSTNAME)
                            new_p3 = [l for l in links_p3 if l not in links_p1 and l not in links_p2]
                            print(f"    Pág 3: {len(links_p3)} links, {len(new_p3)} novos")
                        
                        # Test template
                        template = _url_to_template(probe_url, page_num=2)
                        print(f"\n    Template: {template}")
                        break
                    else:
                        print(f"    ✗ Mesmos imóveis da pág 1")
                else:
                    print(f"    ✗ 0 detail links")
            else:
                print(f"    ✗ Sem resposta")
    else:
        print(f"  → Paginação via <a href>: {dom_url}")
else:
    print(f"  → Nenhuma paginação detectada!")
    
    # Extra: check if buttons exist at all
    print(f"\n=== STEP 3b: Checking buttons manually ===")
    try:
        buttons = page.css("nav button")
        print(f"  nav button: {len(buttons)} encontrados")
        for btn in buttons[:8]:
            text = ""
            try:
                text = (btn.text or "").strip()
            except:
                pass
            cls = btn.attrib.get("class", "")[:60]
            print(f"    text='{text}' class='{cls}'")
    except Exception as e:
        print(f"  Erro: {e}")

print(f"\n=== STEP 5: _detect_page2_url (full pipeline) ===")
page2_url = _detect_page2_url(page, LISTING_URL, BASE_HOSTNAME, use_stealth=True)
print(f"Resultado: {page2_url}")
