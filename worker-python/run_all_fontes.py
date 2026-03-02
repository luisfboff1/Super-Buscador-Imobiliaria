"""
Script para rodar TODAS as 14 fontes sequencialmente,
monitorar progresso e gerar relatório final.
"""
import requests, time, json, sys
from datetime import datetime

BASE = "http://localhost:3001"
SECRET = "meu-segredo-super-secreto-2026"
HEADERS = {"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"}

FONTES = [
    ("0fe2a85f-db04-494d-9335-da261cecaf8a", "Casa Rosa"),
    ("28020ef1-1904-4f31-988e-27a1952bb09f", "Terra e Lar"),
    ("bcf596fd-2aa7-42fc-b0b0-d38358e205c5", "Inovare"),
    ("d3c4659b-ac75-4bb5-9a0d-c095402d79ad", "Perini"),
    ("3c27bfdf-8189-470b-9797-eac121aef0de", "Pioner"),
    ("57ce417b-b08b-4bd1-97f3-02deccbe7225", "Grazziotin"),
    ("91a4884f-c46b-41ab-b100-6877d60c18df", "Attuale"),
    ("9fde8f8b-3b84-438c-8154-1adc8881db59", "Bolsa de Imóveis"),
    ("28c615c0-02b9-477a-8f8e-62b520b8d0c5", "Coimca"),
    ("99929e79-7993-4454-a1c4-6b3e1eea38cd", "Antonella"),
    ("9954c887-d795-4ea5-98f8-8a46b4d69dd7", "Balen"),
    ("69101545-d4a0-46d1-90e7-935469cdf024", "Bassanesi"),
    ("c9bcf321-3e40-498b-bdb4-f76842dbcb17", "Nichele"),
    ("afb1446e-2564-49b3-b690-34373ba5539b", "Perfeccto"),
]


def trigger_crawl(fonte_id: str) -> dict:
    """Dispara crawl. Retry automático se servidor retornar 429 (limite concorrência)."""
    body = {"fonteId": fonte_id, "resetCrawl": True}
    for attempt in range(60):  # até 5min esperando slot
        r = requests.post(f"{BASE}/crawl", json=body, headers=HEADERS, timeout=30)
        if r.status_code == 429:
            print(f"  ⏳ Servidor ocupado (429), aguardando 5s... (tentativa {attempt+1})", flush=True)
            time.sleep(5)
            continue
        return r.json()
    return {"error": "Timeout esperando slot de crawl"}


def wait_until_idle(fonte_name: str, poll_interval: int = 15, max_wait: int = 14400) -> dict | None:
    """Espera até não ter crawls ativos. Retorna última entry do /status history."""
    start = time.time()
    last_msg = ""
    while time.time() - start < max_wait:
        try:
            health = requests.get(f"{BASE}/health", timeout=10).json()
            active = health.get("active_crawls", 0)
            if active == 0:
                # Crawl finished — get history
                status = requests.get(f"{BASE}/status", timeout=10).json()
                history = status.get("history", [])
                if history:
                    return history[-1]
                return None

            # Show progress
            status = requests.get(f"{BASE}/status", timeout=10).json()
            active_info = status.get("active", {})
            for fid, info in active_info.items():
                msg = info.get("last_message", "")
                if msg != last_msg:
                    elapsed = round(time.time() - start)
                    print(f"  [{elapsed}s] {msg}", flush=True)
                    last_msg = msg
        except Exception as e:
            print(f"  [poll error: {e}]", flush=True)

        time.sleep(poll_interval)

    print(f"  ⚠ TIMEOUT após {max_wait}s!", flush=True)
    return None


def main():
    print("=" * 70)
    print(f"  CRAWL COMPLETO — {len(FONTES)} FONTES — SEM LIMITE DE ENRIQUECIMENTO")
    print(f"  Início: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    all_results = []
    total_start = time.time()

    for idx, (fonte_id, nome) in enumerate(FONTES, 1):
        print(f"\n{'─' * 70}")
        print(f"  [{idx}/{len(FONTES)}] {nome}")
        print(f"  ID: {fonte_id}")
        print(f"{'─' * 70}")

        t0 = time.time()
        try:
            resp = trigger_crawl(fonte_id)
            print(f"  → Trigger: {resp.get('status', resp)}", flush=True)

            if resp.get("error"):
                all_results.append({
                    "nome": nome, "fonte_id": fonte_id,
                    "status": "trigger_error", "error": resp["error"],
                    "urls_found": 0, "enriched": 0, "failed": 0,
                    "elapsed_s": 0,
                })
                continue

            # Wait for completion
            result = wait_until_idle(nome, poll_interval=15, max_wait=14400)
            elapsed = round(time.time() - t0, 1)

            if result:
                result["elapsed_s"] = elapsed  # Use our measured time
                all_results.append(result)
                print(f"\n  ✓ {nome}: {result.get('urls_found', '?')} URLs, "
                      f"{result.get('enriched', '?')} enriquecidos, "
                      f"{result.get('failed', '?')} falhas, {elapsed}s", flush=True)
            else:
                all_results.append({
                    "nome": nome, "fonte_id": fonte_id,
                    "status": "timeout", "urls_found": 0,
                    "enriched": 0, "failed": 0, "elapsed_s": elapsed,
                })
                print(f"\n  ⚠ {nome}: Timeout!", flush=True)

        except Exception as e:
            elapsed = round(time.time() - t0, 1)
            all_results.append({
                "nome": nome, "fonte_id": fonte_id,
                "status": "error", "error": str(e),
                "urls_found": 0, "enriched": 0, "failed": 0,
                "elapsed_s": elapsed,
            })
            print(f"\n  ✗ {nome}: {e}", flush=True)

    total_elapsed = round(time.time() - total_start, 1)

    # ── RELATÓRIO FINAL ──
    print(f"\n\n{'=' * 70}")
    print(f"  RELATÓRIO FINAL — TODAS AS FONTES")
    print(f"  Tempo total: {total_elapsed:.0f}s ({total_elapsed/60:.1f}min)")
    print(f"  Fim: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'=' * 70}")
    print()

    # Header
    print(f"{'Fonte':<25} {'URLs':>6} {'Enriq':>6} {'Falhas':>7} {'Tempo':>10} {'Status':<15}")
    print(f"{'─' * 25} {'─' * 6} {'─' * 6} {'─' * 7} {'─' * 10} {'─' * 15}")

    total_urls = 0
    total_enriched = 0
    total_failed = 0
    success_count = 0

    for r in all_results:
        nome = r.get("fonte_nome", r.get("nome", "?"))[:24]
        urls = r.get("urls_found", 0)
        enriched = r.get("enriched", 0)
        failed = r.get("failed", 0)
        elapsed = r.get("elapsed_s", 0)
        status = r.get("status", "?")

        total_urls += urls
        total_enriched += enriched
        total_failed += failed
        if status == "ok":
            success_count += 1

        # Format time
        if elapsed > 3600:
            time_str = f"{elapsed/3600:.1f}h"
        elif elapsed > 60:
            time_str = f"{elapsed/60:.1f}min"
        else:
            time_str = f"{elapsed:.0f}s"

        print(f"{nome:<25} {urls:>6} {enriched:>6} {failed:>7} {time_str:>10} {status:<15}")

    print(f"{'─' * 25} {'─' * 6} {'─' * 6} {'─' * 7} {'─' * 10} {'─' * 15}")
    total_time_str = f"{total_elapsed/60:.1f}min" if total_elapsed < 3600 else f"{total_elapsed/3600:.1f}h"
    print(f"{'TOTAL':<25} {total_urls:>6} {total_enriched:>6} {total_failed:>7} {total_time_str:>10} {success_count}/{len(FONTES)} ok")

    print(f"\n{'=' * 70}")
    print(f"  MÉTRICAS GERAIS:")
    print(f"    Total URLs descobertas:   {total_urls}")
    print(f"    Total enriquecidos:       {total_enriched}")
    print(f"    Total falhas:             {total_failed}")
    print(f"    Taxa de sucesso:          {(total_enriched/(total_urls or 1))*100:.1f}%")
    print(f"    Fontes OK:                {success_count}/{len(FONTES)}")
    print(f"    Tempo total:              {total_time_str}")
    print(f"{'=' * 70}")

    # Save JSON report
    report = {
        "timestamp": datetime.now().isoformat(),
        "total_elapsed_s": total_elapsed,
        "total_urls": total_urls,
        "total_enriched": total_enriched,
        "total_failed": total_failed,
        "fontes_ok": success_count,
        "fontes_total": len(FONTES),
        "results": all_results,
    }
    with open("crawl_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\n  📄 Relatório JSON salvo: crawl_report.json")


if __name__ == "__main__":
    main()
