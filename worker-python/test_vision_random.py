"""
Smoke test do novo pipeline: pega uma URL aleatoria do banco, roda
o scrape completo com CRAWL_VISION_ENABLED=1 e compara com o que estava
salvo antes.

Uso (PowerShell):
    $env:CRAWL_VISION_ENABLED='1'
    doppler run -- python test_vision_random.py

Ou para pular vision (so testar Pydantic + candidates + og:image):
    doppler run -- python test_vision_random.py
"""
import os
import sys
import time
import psycopg2

# Forca UTF-8 no stdout para Windows (cp1252 padrao quebra com caracteres acentuados)
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# Permite override pela CLI
if "--vision" in sys.argv:
    os.environ["CRAWL_VISION_ENABLED"] = "1"
if "--no-vision" in sys.argv:
    os.environ["CRAWL_VISION_ENABLED"] = "0"

sys.path.insert(0, ".")
from app.logger import setup_logging
setup_logging()

from app.crawler import scrape_property_page
from app.extractor import _collect_numeric_candidates


def _get_random_imovel():
    """Pega um imovel aleatorio do banco com pelo menos url_anuncio."""
    conn = psycopg2.connect(os.environ["DATABASE_URL"], sslmode="require")
    cur = conn.cursor()
    cur.execute(
        """
        SELECT i.url_anuncio, i.titulo, i.preco, i.area_m2, i.quartos,
               i.banheiros, i.vagas, i.bairro, i.cidade, i.tipo,
               f.nome AS fonte_nome, f.cidade AS fonte_cidade, f.estado AS fonte_estado
        FROM imoveis i
        JOIN fontes f ON f.id = i.fonte_id
        WHERE i.disponivel = true AND f.ativa = true
        ORDER BY random()
        LIMIT 1
        """
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    keys = [
        "url_anuncio", "titulo", "preco", "area_m2", "quartos",
        "banheiros", "vagas", "bairro", "cidade", "tipo",
        "fonte_nome", "fonte_cidade", "fonte_estado",
    ]
    return dict(zip(keys, row))


def _fmt(v, prefix=""):
    if v is None:
        return "N/A"
    if isinstance(v, float):
        return f"{prefix}{v:,.2f}".rstrip("0").rstrip(".")
    return f"{prefix}{v}"


def main():
    vision_on = os.environ.get("CRAWL_VISION_ENABLED", "0") == "1"
    print(f"{'=' * 78}")
    print(f"SMOKE TEST — pipeline novo  (vision={'ON' if vision_on else 'OFF'})")
    print(f"Modelo: {os.environ.get('CRAWL_LLM_MODEL', 'gpt-5.4-mini')}")
    print(f"Reasoning: {os.environ.get('CRAWL_LLM_REASONING', 'minimal')}")
    print(f"{'=' * 78}\n")

    if not os.environ.get("OPENAI_API_KEY"):
        print("✗ OPENAI_API_KEY nao configurada. Rode com `doppler run -- ...`")
        sys.exit(1)
    if not os.environ.get("DATABASE_URL"):
        print("✗ DATABASE_URL nao configurada. Rode com `doppler run -- ...`")
        sys.exit(1)

    imovel = _get_random_imovel()
    if not imovel:
        print("✗ Nenhum imovel encontrado no banco")
        return

    url = imovel["url_anuncio"]
    print(f"URL:           {url}")
    print(f"Fonte:         {imovel['fonte_nome']}")
    print(f"\n— ANTES (banco) —")
    print(f"  titulo:    {imovel['titulo']}")
    print(f"  tipo:      {imovel['tipo']}")
    print(f"  preco:     {_fmt(imovel['preco'], 'R$')}")
    print(f"  area_m2:   {_fmt(imovel['area_m2'])}")
    print(f"  quartos:   {_fmt(imovel['quartos'])}")
    print(f"  banheiros: {_fmt(imovel['banheiros'])}")
    print(f"  vagas:     {_fmt(imovel['vagas'])}")
    print(f"  bairro:    {imovel['bairro']}")
    print(f"  cidade:    {imovel['cidade']}")

    print(f"\n— RODANDO scrape_property_page —")
    t0 = time.time()
    result = scrape_property_page(
        url,
        fallback_cidade=imovel["fonte_cidade"],
        fallback_estado=imovel["fonte_estado"],
        template=None,  # forca pipeline completa (JSON-LD -> regex -> LLM)
    )
    elapsed = time.time() - t0

    if not result:
        print(f"\n✗ Pipeline retornou None ({elapsed:.1f}s)")
        return

    # Re-coleta os candidatos so para mostrar no log
    print(f"\n— RESULTADO ({elapsed:.1f}s) —")
    fields = [
        ("titulo",    result.titulo),
        ("tipo",      result.tipo),
        ("transacao", result.transacao),
        ("preco",     _fmt(result.preco, "R$") if result.preco else "N/A"),
        ("area_m2",   _fmt(result.area_m2) if result.area_m2 else "N/A"),
        ("quartos",   result.quartos),
        ("banheiros", result.banheiros),
        ("vagas",     result.vagas),
        ("bairro",    result.bairro),
        ("cidade",    result.cidade),
        ("estado",    result.estado),
        ("imagens",   f"{len(result.imagens)} (principal: {result.imagens[0] if result.imagens else 'N/A'})"),
        ("descricao", (result.descricao or "")[:80] + "…" if result.descricao and len(result.descricao) > 80 else result.descricao),
    ]
    for k, v in fields:
        print(f"  {k:10s} {v}")
    print(f"\n  fields_count: {result.fields_count}")

    # Diff vs banco — campos onde MUDOU
    print(f"\n— DIFF vs banco —")
    diffs = []
    for k in ("preco", "area_m2", "quartos", "banheiros", "vagas", "bairro", "cidade", "tipo"):
        old = imovel[k]
        new = getattr(result, k)
        # Normaliza tipos numericos para comparacao
        if isinstance(old, (int, float)) and isinstance(new, (int, float)):
            same = abs(float(old) - float(new)) < 0.01
        else:
            same = str(old or "").strip().lower() == str(new or "").strip().lower()
        if not same:
            diffs.append(f"  {k}: {old} → {new}")
    if diffs:
        for d in diffs:
            print(d)
    else:
        print("  (nenhuma mudanca)")


if __name__ == "__main__":
    main()
