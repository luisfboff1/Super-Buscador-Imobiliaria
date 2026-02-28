"""Diagnóstico de extração para Perfectto."""
import sys, re
sys.stdout.reconfigure(encoding='utf-8')

url = 'https://www.perfecctoimoveis.com.br/imovel/caxias-do-sul/sobrados/3542524'

from app.crawler import fetch_page, has_real_content, safe_html
from app.extractor import extract_quick_regex, extract_from_json_ld, extract_property_data, SiteTemplate

print("=== HTTP FETCH ===")
page_http = fetch_page(url, stealth=False)
if page_http:
    html_http = safe_html(page_http)
    real_http = has_real_content(page_http)
    print(f"HTML length: {len(html_http)}")
    print(f"has_real_content: {real_http}")
    matches = re.findall(r'r\$\s*([\d.,]+)', html_http.lower())
    print(f"Precos no HTML: {matches[:5]}")
    print(f"Primeiros 400 chars:\n{html_http[:400]}")
else:
    print("HTTP: None / falhou")

print()
print("=== STEALTH FETCH ===")
page_stealth = fetch_page(url, stealth=True)
if page_stealth:
    html_stealth = safe_html(page_stealth)
    real_stealth = has_real_content(page_stealth)
    print(f"HTML length: {len(html_stealth)}")
    print(f"has_real_content: {real_stealth}")
    matches2 = re.findall(r'r\$\s*([\d.,]+)', html_stealth.lower())
    print(f"Precos no HTML: {matches2[:5]}")
else:
    print("Stealth: None / falhou")

print()
print("=== EXTRAÇÃO (usando melhor HTML disponível) ===")
best_html = None
if page_stealth:
    best_html = safe_html(page_stealth)
elif page_http:
    best_html = safe_html(page_http)

if best_html:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(best_html, 'lxml')
    og = soup.find('meta', property='og:title')
    h1 = soup.find('h1')
    print(f"og:title: {og.get('content') if og else None}")
    print(f"h1: {h1.get_text(strip=True) if h1 else None}")

    jld = extract_from_json_ld(best_html, url)
    print(f"\nJSON-LD result: {jld}")

    regex = extract_quick_regex(best_html, url)
    if regex:
        print(f"\nRegex result: titulo={repr(regex.titulo)}, preco={regex.preco}, tipo={regex.tipo}, transacao={regex.transacao}")
    else:
        print("\nRegex result: None")

    print("\nFull pipeline (sem LLM - sem template):")
    result = extract_property_data(best_html, url, "Caxias do Sul", "RS", template=None)
    if result:
        print(f"  titulo: {result.titulo}")
        print(f"  preco: {result.preco}")
        print(f"  tipo: {result.tipo}")
        print(f"  transacao: {result.transacao}")
        print(f"  bairro: {result.bairro}")
        print(f"  quartos: {result.quartos}")
    else:
        print("  -> None (falhou completamente)")

    # Manual step-by-step trace
    print("\n=== TRACE MANUAL DO PIPELINE ===")
    import re as _re
    from bs4 import BeautifulSoup as _BS
    # 404 check
    hit404 = bool(_re.search(r"404|não encontrad|not found", best_html[:2000], _re.I))
    print(f"404 check: {hit404}")
    # Listing check
    soup2 = _BS(best_html[:3000], "lxml")
    og2 = soup2.find("meta", property="og:title")
    quick_title = (og2.get("content", "") if og2 else "").lower()
    if not quick_title:
        h1_2 = soup2.find("h1")
        quick_title = (h1_2.get_text(strip=True) if h1_2 else "").lower()
    print(f"quick_title: {quick_title!r}")
    is_listing = bool(_re.search(r"\d+\s*im[óo]veis?\s+para\s+(alugar|comprar|venda)", quick_title))
    print(f"is_listing: {is_listing}")
    # Fields from regex
    from app.extractor import _missing_fields, extract_via_llm, _ALL_DATA_FIELDS
    r2 = extract_quick_regex(best_html, url)
    if r2:
        print(f"\nRegex fields: titulo={repr(r2.titulo)}, preco={r2.preco}, tipo={r2.tipo}, transacao={r2.transacao}, bairro={r2.bairro}")
    else:
        print("\nRegex: None")
    if r2:
        missing = _missing_fields(r2)
        core_missing = [f for f in missing if f in ("preco", "tipo", "bairro", "transacao")]
        print(f"missing: {missing}")
        print(f"core_missing: {core_missing}")
        should_call_llm = bool(core_missing)
        print(f"should_call_llm: {should_call_llm}")
        if should_call_llm:
            print("Tentando LLM...")
            llm = extract_via_llm(best_html, url)
            print(f"LLM result: {llm}")
else:
    print("Nenhum HTML disponível")
