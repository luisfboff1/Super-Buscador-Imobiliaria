"""Quick test on Pioner (second imobiliária)."""
import sys, time
sys.path.insert(0, ".")
from app.logger import setup_logging
setup_logging()
from scrapling.fetchers import Fetcher
from app.crawler import safe_html
from app.extractor import extract_property_data

urls = [
    "https://www.imobiliariapioner.com.br/imovel/apto-mobiliado/caxias-do-sul/centro/16562",
    "https://www.imobiliariapioner.com.br/imovel/apartamento/caxias-do-sul/centro/14234",
    "https://www.imobiliariapioner.com.br/imovel/apartamento/caxias-do-sul/ana-rech/15695",
]

for url in urls:
    print("\n" + "=" * 70)
    print(url)
    t0 = time.time()
    page = Fetcher.get(url, stealthy_headers=True, timeout=15)
    html = safe_html(page)
    r = extract_property_data(html, url, fallback_cidade="Caxias do Sul", fallback_estado="RS")
    elapsed = time.time() - t0
    if r:
        print(f"  Titulo:    {r.titulo}")
        print(f"  Tipo:      {r.tipo}")
        print(f"  Transacao: {r.transacao}")
        print(f"  Preco:     R${r.preco:,.0f}" if r.preco else "  Preco:     N/A")
        print(f"  Area:      {r.area_m2}m2" if r.area_m2 else "  Area:      N/A")
        print(f"  Quartos:   {r.quartos}")
        print(f"  Banheiros: {r.banheiros}")
        print(f"  Vagas:     {r.vagas}")
        print(f"  Bairro:    {r.bairro}")
        print(f"  Cidade:    {r.cidade}")
        print(f"  Estado:    {r.estado}")
        print(f"  Descr:     {(r.descricao or 'N/A')[:100]}")
        print(f"  Imagens:   {len(r.imagens)}")
        print(f"  Campos:    {r.fields_count}")
    else:
        print("  NENHUM DADO")
    print(f"  Tempo:     {elapsed:.1f}s")
