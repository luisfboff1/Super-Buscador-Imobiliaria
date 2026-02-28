"""Teste rapido de extracao em 3 sites."""
import sys, re
sys.stdout.reconfigure(encoding='utf-8')

from app.crawler import fetch_page, safe_html
from app.extractor import extract_property_data
from bs4 import BeautifulSoup

SITES = [
    ("Perfectto",    "https://www.perfecctoimoveis.com.br/imovel/caxias-do-sul/sobrados/3542524", "Caxias do Sul", "RS"),
    ("Casa Rosa",    "https://www.imobiliariacasarosa.com.br/imovel/caxias-do-sul/casas/3421169", "Caxias do Sul", "RS"),
    ("Nichele",      None,  "Caxias do Sul", "RS"),  # vamos pegar de listagem
]

# Pegar URL de imovel da Nichele
print("Buscando URL de imóvel da Nichele...")
p = fetch_page("https://nicheleimoveis.com.br/imoveis", stealth=True)
if p:
    soup = BeautifulSoup(safe_html(p), "lxml")
    links = [a['href'] for a in soup.find_all('a', href=True)
             if re.search(r'/imovel/|/imoveis/\d+|/detalhe/', a['href'])]
    if links:
        href = links[0]
        nichele_url = href if href.startswith('http') else "https://nicheleimoveis.com.br" + href
        print(f"  Encontrado: {nichele_url}")
        SITES[2] = ("Nichele", nichele_url, "Caxias do Sul", "RS")
    else:
        # fallback: procurar qualquer link com /imoveis/
        links2 = [a['href'] for a in soup.find_all('a', href=True) if '/imoveis/' in a['href'].lower()]
        if links2:
            href = links2[0]
            nichele_url = href if href.startswith('http') else "https://nicheleimoveis.com.br" + href
            print(f"  Fallback: {nichele_url}")
            SITES[2] = ("Nichele", nichele_url, "Caxias do Sul", "RS")
        else:
            print("  Sem URL de imóvel encontrada")
else:
    print("  Fetch falhou")

print()

# Testar cada site
for nome, url, cidade, estado in SITES:
    if not url:
        print(f"[{nome}] SKIP — sem URL")
        continue

    print(f"=== {nome} ===")
    print(f"URL: {url}")

    page = fetch_page(url, stealth=False)
    if not page:
        page = fetch_page(url, stealth=True)
    if not page:
        print(f"  ERRO: fetch falhou\n")
        continue

    html = safe_html(page)

    # Quick 404 check with new regex
    hit404 = bool(re.search(r"(?<!\d)404(?!\d)|não encontrad|not found", html[:2000], re.I))
    precos = re.findall(r'r\$\s*([\d.,]+)', html.lower())
    print(f"  HTML: {len(html)} chars | 404_check={hit404} | precos_brutos={precos[:3]}")

    result = extract_property_data(html, url, cidade, estado)
    if result:
        print(f"  ✅ titulo={result.titulo}")
        print(f"     preco=R${result.preco:,.0f}" if result.preco else "     preco=None")
        print(f"     tipo={result.tipo} | transacao={result.transacao}")
        print(f"     bairro={result.bairro} | quartos={result.quartos} | area={result.area_m2}")
    else:
        print(f"  ❌ extract_property_data retornou None")
    print()
