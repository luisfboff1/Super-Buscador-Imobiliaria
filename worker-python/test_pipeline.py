"""Test extraction pipeline on multiple imobiliárias."""
import os, sys, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.logger import setup_logging
setup_logging()

from scrapling.fetchers import Fetcher
from app.crawler import safe_html
from app.extractor import extract_property_data
from bs4 import BeautifulSoup

# ─── URLs de teste: 2 imobiliárias diferentes ────────────────────────────────

TESTS = [
    # Bassanesi (Caxias do Sul/RS)
    {
        "url": "https://www.bassanesi.com.br/imovel/35804/terreno-para-comprar-com-8080m-maestra-em-caxias-do-sul/",
        "cidade": "Caxias do Sul", "estado": "RS",
    },
    {
        "url": "https://www.bassanesi.com.br/imovel/34840/apartamento-para-comprar-com-84m-2-quartos-2-vagas-no-bairro-madureira-em-caxias-do-sul/",
        "cidade": "Caxias do Sul", "estado": "RS",
    },
]

# Descobrir URLs de detalhe de uma segunda imobiliária
print("\nDescobrir URLs da Pioner para teste...")
try:
    page = Fetcher.get("https://www.imobiliariapioner.com.br/comprar/imoveis/caxias-do-sul", stealthy_headers=True, timeout=15)
    html = safe_html(page)
    soup = BeautifulSoup(html, "lxml")
    detail_urls = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.startswith("http"):
            if href.startswith("/"):
                href = "https://www.imobiliariapioner.com.br" + href
            else:
                continue
        if re.search(r"/imovel/\d+|/detalhe/|/property/|cod[=-]?\d+", href, re.I) and "imobiliariapioner" in href:
            detail_urls.add(href)
    if detail_urls:
        for u in list(detail_urls)[:2]:
            TESTS.append({"url": u, "cidade": "Caxias do Sul", "estado": "RS"})
        print(f"  +{min(2, len(detail_urls))} URLs da Pioner")
    else:
        print("  Nenhuma URL encontrada na Pioner")
except Exception as e:
    print(f"  Erro Pioner: {e}")

# Se não encontrou Pioner, tenta Casa Rosa
if len(TESTS) == 2:
    print("Tentando Coimca...")
    try:
        page = Fetcher.get("https://www.coimca.com.br/comprar", stealthy_headers=True, timeout=15)
        html = safe_html(page)
        soup = BeautifulSoup(html, "lxml")
        detail_urls = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if not href.startswith("http"):
                if href.startswith("/"):
                    href = "https://www.coimca.com.br" + href
                else:
                    continue
            if re.search(r"/imovel/|/detalhe/|/property/|/venda/|cod[=-]?\d+", href, re.I) and "coimca" in href:
                detail_urls.add(href)
        if detail_urls:
            for u in list(detail_urls)[:2]:
                TESTS.append({"url": u, "cidade": None, "estado": None})
            print(f"  +{min(2, len(detail_urls))} URLs da Coimca")
    except Exception as e:
        print(f"  Erro Coimca: {e}")

# ─── Executar testes ──────────────────────────────────────────────────────────

print(f"\n{'='*70}")
print(f"TESTANDO {len(TESTS)} URLs")
print(f"{'='*70}")

results = []
for i, test in enumerate(TESTS):
    url = test["url"]
    print(f"\n{'─'*70}")
    print(f"[{i+1}/{len(TESTS)}] {url[:80]}")
    print(f"{'─'*70}")

    t0 = time.time()
    try:
        page = Fetcher.get(url, stealthy_headers=True, timeout=15)
        html = safe_html(page)
        result = extract_property_data(
            html, url,
            fallback_cidade=test.get("cidade"),
            fallback_estado=test.get("estado"),
        )
    except Exception as e:
        print(f"  ERRO: {e}")
        result = None

    elapsed = time.time() - t0

    if result:
        print(f"  Título:    {result.titulo}")
        print(f"  Tipo:      {result.tipo or 'N/A'}")
        print(f"  Transação: {result.transacao or 'N/A'}")
        print(f"  Preço:     R${result.preco:,.0f}" if result.preco else "  Preço:     N/A")
        print(f"  Área:      {result.area_m2}m²" if result.area_m2 else "  Área:      N/A")
        print(f"  Quartos:   {result.quartos or 'N/A'}")
        print(f"  Banheiros: {result.banheiros or 'N/A'}")
        print(f"  Vagas:     {result.vagas or 'N/A'}")
        print(f"  Bairro:    {result.bairro or 'N/A'}")
        print(f"  Cidade:    {result.cidade or 'N/A'}")
        print(f"  Estado:    {result.estado or 'N/A'}")
        print(f"  Descr:     {(result.descricao or 'N/A')[:80]}")
        print(f"  Imagens:   {len(result.imagens)}")
        print(f"  Campos:    {result.fields_count}")
        results.append(result)
    else:
        print(f"  NENHUM DADO (filtrado ou sem dados)")
    print(f"  Tempo:     {elapsed:.1f}s")

# ─── Resumo ──────────────────────────────────────────────────────────────────

print(f"\n{'='*70}")
print(f"RESUMO: {len(results)}/{len(TESTS)} extrações bem-sucedidas")
print(f"{'='*70}")
for r in results:
    trans = r.transacao or "?"
    preco = f"R${r.preco:,.0f}" if r.preco else "s/preço"
    print(f"  [{trans:7s}] {preco:>14s} | {r.tipo or '?':12s} | {r.quartos or '?'}q | {(r.titulo or '?')[:50]}")
