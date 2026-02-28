"""
orchestrator.py
- Le fontes do banco
- Dispara crawl de todas as fontes ativas, UMA POR VEZ
- Monitora via banco de dados
- Gera relatorio final de timings
"""
import requests, time, sys, json, os, psycopg2
from datetime import datetime

WORKER_URL = "http://localhost:3001"
AUTH = {"Authorization": "Bearer meu-segredo-super-secreto-2026"}
POLL_INTERVAL = 10  # segundos

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def wait_for_worker(timeout=120):
    print("Aguardando worker subir...", end="", flush=True)
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = requests.get(f"{WORKER_URL}/health", timeout=5)
            if r.status_code == 200:
                print(" Worker UP!")
                return True
        except Exception:
            pass
        print(".", end="", flush=True)
        time.sleep(3)
    print(" Worker nao respondeu!")
    return False

def get_fontes_from_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, nome, url FROM fontes WHERE ativa = true ORDER BY nome")
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "nome": r[1], "url": r[2]} for r in rows]

def reset_crawling_fontes():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE fontes SET status = 'idle' WHERE status = 'crawling'")
    count = cur.rowcount
    conn.commit()
    conn.close()
    if count > 0:
        print(f"Reset {count} fonte(s) de crawling para idle")

def get_fonte_status_db(fonte_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT status, crawl_progress FROM fontes WHERE id = %s", (fonte_id,))
    row = cur.fetchone()
    conn.close()
    if row:
        return {"status": row[0], "crawl_progress": row[1]}
    return None

def trigger_crawl(fonte_id):
    r = requests.post(
        f"{WORKER_URL}/crawl",
        json={"fonteId": fonte_id},
        headers=AUTH,
        timeout=10
    )
    return r.status_code, r.json() if r.content else {}

def wait_for_crawl(fonte_id, fonte_nome):
    t0 = time.time()
    last_done = -1
    print(f"  Aguardando inicio...", end="", flush=True)
    for _ in range(30):
        time.sleep(2)
        info = get_fonte_status_db(fonte_id)
        if info and info["status"] == "crawling":
            print(" iniciado!")
            break
    else:
        print(" (timeout inicio)")

    while True:
        time.sleep(POLL_INTERVAL)
        info = get_fonte_status_db(fonte_id)
        if not info:
            continue

        status = info["status"]
        prog = info.get("crawl_progress") or {}
        done = prog.get("done", 0)
        total = prog.get("total", 0)
        fase = prog.get("fase", "?")
        elapsed_w = prog.get("elapsed", "?")

        if done != last_done:
            pct = round(done / total * 100) if total > 0 else 0
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"    [{ts}] {fonte_nome[:22]:22s} {done:4d}/{total:4d} ({pct:3d}%) | {fase} | {elapsed_w}")
            last_done = done

        finished = prog.get("finished", False)
        if status in ("ok", "erro") or finished:
            wall_elapsed = time.time() - t0
            return round(wall_elapsed), info

def main():
    print("\n" + "="*70)
    print("  ORCHESTRATOR - Crawl completo de todas as fontes")
    print("  " + datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    print("="*70 + "\n")

    reset_crawling_fontes()

    if not wait_for_worker(timeout=180):
        sys.exit(1)

    fontes = get_fontes_from_db()
    print(f"\n{len(fontes)} fontes ativas:")
    for f in fontes:
        print(f"   * {f['nome']:35s} ({f['url'][:50]})")

    print(f"\nIniciando {len(fontes)} crawls (1 por vez)\n")
    print("-" * 70)

    results = []
    grand_start = time.time()

    for i, fonte in enumerate(fontes, 1):
        fid = fonte["id"]
        fname = fonte["nome"]
        furl = fonte.get("url", "")

        print(f"\n[{i:2d}/{len(fontes)}] {fname}")
        print(f"       {furl}")

        t0 = time.time()
        code, resp = trigger_crawl(fid)

        if code == 409:
            print(f"  JA EM ANDAMENTO (HTTP 409)")
        elif code not in (200, 201, 202):
            print(f"  FALHA ao disparar: HTTP {code} -- {resp}")
            results.append({
                "fonte_id": fid, "nome": fname, "url": furl,
                "status": "erro_trigger", "wall_elapsed_s": 0,
                "worker_elapsed": "N/A", "total": 0, "done": 0,
                "failed": 0, "message": f"HTTP {code}",
            })
            continue
        else:
            print(f"  Crawl disparado (HTTP {code})")

        wall_s, final_info = wait_for_crawl(fid, fname)
        prog = (final_info or {}).get("crawl_progress") or {}
        final_status = (final_info or {}).get("status", "?")
        msg = prog.get("message", "")

        icon = "OK" if final_status == "ok" else "ERRO"
        print(f"  [{icon}] Concluido em {wall_s}s (worker: {prog.get('elapsed','?')}) -- {msg[:60]}")

        results.append({
            "fonte_id": fid,
            "nome": fname,
            "url": furl,
            "status": final_status,
            "wall_elapsed_s": wall_s,
            "worker_elapsed": prog.get("elapsed", "?"),
            "total": prog.get("total", 0),
            "done": prog.get("done", 0),
            "failed": prog.get("failed", 0),
            "message": msg,
        })

    grand_elapsed = round(time.time() - grand_start)

    out_file = f"crawl_timing_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("\n\n" + "="*80)
    print("  RESUMO DE TIMING -- TODAS AS FONTES")
    print("="*80)
    print(f"  {'Nome':35s} {'St':4s} {'URLs':5s} {'Err':4s} {'Tempo Worker':14s} {'Parede':8s}")
    print("-"*80)

    for r in results:
        icn = "OK " if r["status"] == "ok" else "ERR"
        nome = r["nome"][:34].ljust(35)
        st = (r["status"][:3]).ljust(4)
        urls = str(r.get("total", 0)).rjust(5)
        erros = str(r.get("failed", 0)).rjust(4)
        tw = str(r.get("worker_elapsed", "?")).rjust(14)
        tp = f"{r['wall_elapsed_s']}s".rjust(8)
        print(f"  {icn} {nome} {st} {urls} {erros} {tw} {tp}")

    print("="*80)
    print(f"  Tempo total: {round(grand_elapsed/60, 1)} min  ({grand_elapsed}s)")
    print(f"  Arquivo:     {out_file}")
    print("="*80)

    problemas = [r for r in results if r["status"] != "ok" or r["failed"] > 0]
    if problemas:
        print("\n  PROBLEMAS:")
        for r in problemas:
            print(f"  ** {r['nome'][:35]:35s} status={r['status']} failed={r['failed']} {r['message'][:50]}")

    print("\nPara analise de qualidade:")
    print("cd c:\\Users\\Luisf\\Documents\\GITHUB\\Super-Buscador-Imobiliaria")
    print("doppler run -- npx tsx scripts/check-all-fontes.ts")

if __name__ == "__main__":
    main()
