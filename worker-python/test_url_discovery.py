"""
test_imoveis_count.py  (test_url_discovery.py)
----------------------------------------------
Para cada fonte roda Fase 1 + Fase 2 via discover_property_urls():
  - Fase 1: LLM analisa homepage → confirma listing URLs
  - Fase 2: Pagina TODAS as páginas de cada listing URL
  - Conta total de URLs de imóveis únicos encontrados
  - NAO enriquece (não busca dados de cada imóvel)

Resultado: quantos imóveis o crawler ENCONTRARIA se fosse crawlar de verdade.

Uso:
    doppler run -- venv\\Scripts\\python.exe test_url_discovery.py
    doppler run -- venv\\Scripts\\python.exe test_url_discovery.py --fonte "Perini"
"""

import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))

import logging
logging.disable(logging.CRITICAL)

from app.crawler import discover_property_urls
from app.db import cursor as db_cursor


def get_all_fontes():
    with db_cursor() as cur:
        cur.execute(
            "SELECT id, nome, url, cidade, estado, status, config FROM fontes ORDER BY nome"
        )
        return cur.fetchall()


def main():
    filter_nome = None
    if "--fonte" in sys.argv:
        i = sys.argv.index("--fonte")
        filter_nome = sys.argv[i + 1].lower() if i + 1 < len(sys.argv) else None

    fontes = get_all_fontes()
    if filter_nome:
        fontes = [f for f in fontes if filter_nome in f["nome"].lower()]

    total = len(fontes)
    now = time.strftime("%Y-%m-%d %H:%M")
    print(f"\n{'='*65}")
    print(f"  CONTAGEM DE IMÓVEIS (sem enriquecimento) — {total} fontes")
    print(f"  {now}")
    print(f"{'='*65}\n")

    results = []
    global_start = time.time()

    for i, fonte in enumerate(fontes, 1):
        nome = fonte["nome"]
        url  = fonte["url"]

        print(f"[{i:02d}/{total}] {nome}")
        print(f"         {url}", flush=True)

        log_lines = []

        def on_progress(msg):
            log_lines.append(msg)
            print(f"  {msg}", flush=True)

        t0 = time.time()
        try:
            imovel_urls = discover_property_urls(
                site_url=url,
                on_progress=on_progress,
                site_config=fonte.get("config") or {},
            )
            elapsed = time.time() - t0
            count  = len(imovel_urls)
            status = "OK" if count > 0 else "VAZIO"
            print(f"\n  ✅ {count} imóveis únicos em {elapsed:.0f}s\n", flush=True)
        except Exception as e:
            elapsed = time.time() - t0
            count  = 0
            status = f"ERRO: {e}"
            print(f"\n  ❌ ERRO: {e}\n", flush=True)

        results.append({
            "nome":    nome,
            "url":     url,
            "count":   count,
            "elapsed": elapsed,
            "status":  status,
            "log":     log_lines,
        })

    # ── Tabela final ──────────────────────────────────────────────────────
    total_elapsed = time.time() - global_start
    print(f"\n{'='*65}")
    print(f"  RELATÓRIO FINAL  |  Tempo total: {total_elapsed/60:.1f} min")
    print(f"{'='*65}")
    print(f"  {'#':>2}  {'Fonte':<30}  {'Imóveis':>7}  {'Tempo':>7}  Status")
    print(f"  {'-'*60}")

    ok_c = vazio_c = erro_c = 0
    total_imoveis = 0
    for idx, r in enumerate(results, 1):
        nome_s   = r["nome"][:29]
        count    = r["count"]
        elapsed  = r["elapsed"]
        status   = r["status"]
        total_imoveis += count

        if status == "OK":
            ok_c  += 1
            icon   = "✅"
            note   = ""
        elif status == "VAZIO":
            vazio_c += 1
            icon    = "⚠️ "
            note    = "VAZIO"
        else:
            erro_c += 1
            icon   = "❌"
            note   = status[:30]

        print(f"  {idx:>2}  {nome_s:<30}  {count:>7}  {elapsed:>6.0f}s  {icon} {note}")

    print(f"  {'-'*60}")
    print(f"  {'TOTAL':<34}  {total_imoveis:>7}  {total_elapsed:>6.0f}s")
    print(f"\n  ✅ OK: {ok_c}   ⚠️  Vazio: {vazio_c}   ❌ Erro: {erro_c}")
    print(f"{'='*65}\n")

    # ── Detalhes dos que falharam ──────────────────────────────────────────
    failed = [r for r in results if r["status"] != "OK"]
    if failed:
        print("── FONTES COM PROBLEMA ─────────────────────────────────────────")
        for r in failed:
            print(f"\n  {r['nome']}  ({r['status']})")
            for line in r["log"][-8:]:
                print(f"    {line}")


if __name__ == "__main__":
    main()
