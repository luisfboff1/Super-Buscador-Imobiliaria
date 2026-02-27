"""
Worker HTTP Server — FastAPI

Endpoints:
- GET  /health     → health check
- POST /crawl      → inicia crawl de uma fonte (async, retorna imediatamente)
- GET  /status     → métricas de crawls em andamento

Autenticação via header: Authorization: Bearer <WORKER_SECRET>

Logs detalhados para monitoramento no Railway.
"""

import os
import threading
import time
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv

load_dotenv()  # carrega .env em dev

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.logger import setup_logging, get_logger
from app.db import get_fonte_by_id, update_fonte_status, test_connection
from app.crawler import execute_crawl, CrawlStats

# ─── Logging ──────────────────────────────────────────────────────────────────

setup_logging()
log = get_logger("server")

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Super Buscador Worker (Scrapling)",
    version="2.0.0",
    docs_url=None,  # sem swagger em prod
    redoc_url=None,
)

WORKER_SECRET = os.environ.get("WORKER_SECRET", "")

# ─── Estado de crawls ativos ─────────────────────────────────────────────────

active_crawls: dict[str, dict] = {}
crawl_history: list[dict] = []  # últimos 20 crawls


class CrawlRequest(BaseModel):
    fonteId: str


# ─── Auth middleware ──────────────────────────────────────────────────────────

def check_auth(request: Request) -> None:
    """Verifica Bearer token."""
    if not WORKER_SECRET:
        return  # dev mode sem secret
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "")
    if token != WORKER_SECRET:
        log.warning(f"Auth falhou — IP: {request.client.host if request.client else '?'}")
        raise HTTPException(status_code=401, detail="Unauthorized")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check para Railway."""
    return {
        "status": "ok",
        "engine": "scrapling",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "active_crawls": len(active_crawls),
        "python": True,
    }


@app.get("/status")
async def status():
    """Status detalhado dos crawls."""
    return {
        "active": active_crawls,
        "history": crawl_history[-20:],
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/crawl")
async def crawl(body: CrawlRequest, request: Request):
    """
    Inicia crawl de uma fonte.
    Retorna imediatamente — processa em background thread.
    """
    check_auth(request)

    fonte_id = body.fonteId
    if not fonte_id:
        raise HTTPException(status_code=400, detail="fonteId required")

    # Verifica se já está rodando
    if fonte_id in active_crawls:
        return JSONResponse(
            status_code=409,
            content={
                "error": "Crawl já em andamento para esta fonte",
                "fonteId": fonte_id,
                "startedAt": active_crawls[fonte_id]["started_at"],
            },
        )

    log.info(f"━━━ Crawl requisitado: fonte {fonte_id[:8]}... ━━━")

    # Dispara em background thread
    thread = threading.Thread(
        target=_run_crawl_background,
        args=(fonte_id,),
        daemon=True,
    )
    thread.start()

    return {"status": "started", "fonteId": fonte_id}


# ─── Background crawl execution ──────────────────────────────────────────────

def _run_crawl_background(fonte_id: str) -> None:
    """Executa crawl em background thread com logging completo."""
    crawl_start = time.time()
    crawl_log: list[str] = []

    def on_progress(msg: str):
        """Callback que loga E salva no estado."""
        log.info(msg)
        crawl_log.append(msg)
        # Atualiza estado ativo
        if fonte_id in active_crawls:
            active_crawls[fonte_id]["last_message"] = msg
            active_crawls[fonte_id]["log_lines"] = len(crawl_log)

    try:
        # 1. Buscar fonte no DB
        log.info(f"Buscando fonte {fonte_id[:8]}... no banco")
        fonte = get_fonte_by_id(fonte_id)
        if not fonte:
            log.error(f"✗ Fonte {fonte_id} não encontrada no DB")
            return

        log.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        log.info(f"CRAWL INICIANDO")
        log.info(f"  Fonte: {fonte.nome}")
        log.info(f"  URL: {fonte.url}")
        log.info(f"  Cidade: {fonte.cidade}, Estado: {fonte.estado}")
        log.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

        # 2. Registrar como ativo
        active_crawls[fonte_id] = {
            "fonte_nome": fonte.nome,
            "url": fonte.url,
            "started_at": datetime.utcnow().isoformat(),
            "last_message": "Iniciando...",
            "log_lines": 0,
        }

        # 3. Marcar como crawling no DB
        update_fonte_status(fonte_id, "crawling")

        # 4. Executar crawl
        stats = execute_crawl(
            fonte_id=fonte_id,
            site_url=fonte.url,
            cidade=fonte.cidade,
            estado=fonte.estado,
            on_progress=on_progress,
        )

        # 5. Marcar como OK
        update_fonte_status(fonte_id, "ok")

        # 6. Registrar no histórico
        elapsed = time.time() - crawl_start
        entry = {
            "fonte_id": fonte_id,
            "fonte_nome": fonte.nome,
            "url": fonte.url,
            "status": "ok",
            "urls_found": stats.urls_found,
            "enriched": stats.enriched,
            "failed": stats.failed,
            "elapsed_s": round(elapsed, 1),
            "finished_at": datetime.utcnow().isoformat(),
        }
        crawl_history.append(entry)
        if len(crawl_history) > 50:
            crawl_history.pop(0)

        log.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        log.info(f"✓ CRAWL CONCLUÍDO COM SUCESSO")
        log.info(f"  Fonte: {fonte.nome}")
        log.info(f"  URLs: {stats.urls_found}")
        log.info(f"  Enriquecidos: {stats.enriched}")
        log.info(f"  Falhas: {stats.failed}")
        log.info(f"  Tempo: {elapsed:.1f}s")
        log.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    except Exception as e:
        elapsed = time.time() - crawl_start
        error_msg = str(e)
        log.error(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        log.error(f"✗ CRAWL FALHOU")
        log.error(f"  Fonte: {fonte_id[:8]}...")
        log.error(f"  Erro: {error_msg}")
        log.error(f"  Tempo: {elapsed:.1f}s")
        log.error(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

        try:
            update_fonte_status(fonte_id, "erro", error_msg)
        except Exception:
            pass

        crawl_history.append({
            "fonte_id": fonte_id,
            "status": "erro",
            "error": error_msg,
            "elapsed_s": round(elapsed, 1),
            "finished_at": datetime.utcnow().isoformat(),
        })

    finally:
        active_crawls.pop(fonte_id, None)


# ─── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    log.info("🚀 Worker Scrapling iniciando...")
    log.info(f"   Engine: Scrapling (Python)")
    log.info(f"   Secret: {'configurado' if WORKER_SECRET else 'NENHUM (dev mode)'}")
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    # Teste de conexão DB
    test_connection()

    log.info("✓ Worker pronto para receber crawls")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "3001"))
    log.info(f"Iniciando servidor na porta {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
