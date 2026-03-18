"""
Teste rápido: HTTP puro vs Playwright para paginação SPA.
Verifica se HTTP retorna links diferentes por página (site normal)
ou sempre os mesmos (SPA — precisa Playwright).

Uso: doppler run -- python scripts/test_spa_batch.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "worker-python"))

from app.crawler import fetch_page, extract_detail_links

BASE = "https://www.imobiliariaconnect.com.br/imoveis/venda/-/-/-/-"
HOSTNAME = "www.imobiliariaconnect.com.br"
PAGES = [1, 2, 3]

def test_mode(label: str, stealth: bool):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    all_links: set[str] = set()
    for p in PAGES:
        url = f"{BASE}?pagination={p}"
        page = fetch_page(url, stealth=stealth)
        links = extract_detail_links(page, HOSTNAME) if page else []
        new = [l for l in links if l not in all_links]
        all_links.update(links)
        print(f"  Pág {p}: {len(links)} links, {len(new)} novos (total: {len(all_links)})")
    return all_links

http_links = test_mode("HTTP puro (stealth=False)", stealth=False)
pw_links = test_mode("Playwright (stealth=True)", stealth=True)

print(f"\n{'='*60}")
print(f"  RESULTADO")
print(f"{'='*60}")
print(f"  HTTP:       {len(http_links)} links únicos em {len(PAGES)} págs")
print(f"  Playwright: {len(pw_links)} links únicos em {len(PAGES)} págs")
if len(pw_links) > len(http_links):
    print(f"  → SPA CONFIRMADO: Playwright trouxe {len(pw_links) - len(http_links)} links a mais")
    print(f"  → O fix de fallback batch HTTP→Playwright vai resolver")
else:
    print(f"  → Site normal: HTTP funciona igual Playwright")
