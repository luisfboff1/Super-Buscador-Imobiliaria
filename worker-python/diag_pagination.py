"""
Diagnóstico: O que o Playwright vê na listagem da Antonella?
- Quais links de detalhe?
- Quais links de paginação?
- Qual o padrão de href das paginações?
"""
import re
from urllib.parse import urlparse
from scrapling.fetchers import StealthyFetcher

LISTING_URL = "https://www.antonellaimoveis.com.br/imoveis/venda/-/-/-"
BASE_HOSTNAME = "www.antonellaimoveis.com.br"

print(f"=== Fetching {LISTING_URL} com Playwright (disable_resources=False) ===")
page = StealthyFetcher.fetch(
    LISTING_URL,
    headless=True,
    network_idle=True,
    timeout=45000,
    disable_resources=False,
)

if not page:
    print("ERRO: Sem resposta!")
    exit(1)

print(f"Status: OK")

# 1. Todos os links <a href>
all_links = page.css("a[href]")
print(f"\nTotal links <a>: {len(all_links)}")

# 2. Links com /imovel/ (detalhe real)
detail_links = []
# 3. Links com paginação
pagination_links = []
# 4. Links com /-/-/ (filtro/listagem)
filter_links = []
# 5. Outros links do mesmo domínio
other_links = []

for link in all_links:
    href = link.attrib.get("href", "")
    text = ""
    try:
        text = (link.text or "").strip()[:60]
    except:
        pass
    
    if not href or href in ("#", "javascript:void(0)"):
        continue
    
    if href.startswith("/"):
        href = f"https://{BASE_HOSTNAME}{href}"
    elif not href.startswith("http"):
        continue
    
    try:
        if urlparse(href).hostname != BASE_HOSTNAME:
            continue
    except:
        continue
    
    href_lower = href.lower()
    
    # Classificar
    if re.search(r"/imovel/\d+", href):
        detail_links.append((href, text))
    elif any(p in href_lower for p in ["pagination=", "pagina=", "page=", "pag="]):
        pagination_links.append((href, text))
    elif "/-/-/" in href or "/-/-" in href:
        filter_links.append((href, text))
    else:
        other_links.append((href, text))

print(f"\n{'='*60}")
print(f"DETALHE (com /imovel/\\d+): {len(detail_links)}")
print(f"{'='*60}")
for href, text in detail_links[:20]:
    print(f"  {href}  [{text}]")

print(f"\n{'='*60}")
print(f"PAGINAÇÃO (pagination/page/pagina): {len(pagination_links)}")
print(f"{'='*60}")
for href, text in pagination_links:
    print(f"  {href}  [{text}]")

print(f"\n{'='*60}")
print(f"FILTRO/LISTAGEM (com /-/-): {len(filter_links)}")
print(f"{'='*60}")
for href, text in filter_links[:15]:
    print(f"  {href}  [{text}]")
if len(filter_links) > 15:
    print(f"  ... +{len(filter_links)-15} mais")

print(f"\n{'='*60}")
print(f"OUTROS (mesmo domínio): {len(other_links)}")
print(f"{'='*60}")
for href, text in other_links[:10]:
    print(f"  {href}  [{text}]")

# 6. Procurar elementos de paginação no DOM (nav, ul.pagination, etc.)
print(f"\n{'='*60}")
print(f"ELEMENTOS DE PAGINAÇÃO NO DOM")
print(f"{'='*60}")

for sel in ["nav", ".pagination", "[class*=paginat]", "[class*=pagina]", "[class*=page-nav]", "[class*=pager]"]:
    try:
        els = page.css(sel)
        if els:
            print(f"\n  Seletor '{sel}': {len(els)} elemento(s)")
            for el in els[:3]:
                tag = getattr(el, "tag", "?")
                cls = el.attrib.get("class", "")
                inner_text = ""
                try:
                    inner_text = (el.text or "")[:200]
                except:
                    pass
                inner_links = el.css("a[href]") if hasattr(el, 'css') else []
                print(f"    <{tag} class='{cls}'> ({len(inner_links)} links)")
                for a in inner_links[:5]:
                    a_href = a.attrib.get("href", "")
                    a_text = ""
                    try:
                        a_text = (a.text or "").strip()[:30]
                    except:
                        pass
                    print(f"      → {a_href}  [{a_text}]")
    except Exception as e:
        pass

# 7. Procurar qualquer link com "2" no texto
print(f"\n{'='*60}")
print(f"LINKS COM TEXTO '2' OU '›' OU 'Próxima'")
print(f"{'='*60}")
for link in all_links:
    href = link.attrib.get("href", "")
    text = ""
    try:
        text = (link.text or "").strip()
    except:
        pass
    
    if text in ("2", "3", "»", "›", ">", ">>") or "próxima" in text.lower() or "next" in text.lower():
        if href.startswith("/"):
            href = f"https://{BASE_HOSTNAME}{href}"
        print(f"  text='{text}'  href={href}")

# 8. Procurar botões (podem ser <button> ao invés de <a>)
print(f"\n{'='*60}")
print(f"BOTÕES COM TEXTO NUMÉRICO OU NAVEGAÇÃO")
print(f"{'='*60}")
for sel in ["button", "[role=button]", "[type=button]"]:
    try:
        buttons = page.css(sel)
        for btn in buttons:
            text = ""
            try:
                text = (btn.text or "").strip()[:30]
            except:
                pass
            if text and (text.isdigit() or text in ("»", "›", ">", ">>", "Próxima", "Next")):
                cls = btn.attrib.get("class", "")
                onclick = btn.attrib.get("onclick", "")
                print(f"  <{sel}> text='{text}' class='{cls}' onclick='{onclick[:80]}'")
    except:
        pass
