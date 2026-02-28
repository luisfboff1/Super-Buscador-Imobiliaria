"""
Camada de banco de dados — PostgreSQL (Neon) via psycopg2.

Espelho do schema do app Next.js principal.
Mesmo banco, mesmas tabelas, queries compatíveis.
"""

import os
import json
from typing import Optional
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2.extensions import connection as PgConnection

from app.logger import get_logger

log = get_logger("db")

# ─── Conexão ──────────────────────────────────────────────────────────────────

_pool: Optional[PgConnection] = None


def _is_alive(conn: PgConnection) -> bool:
    """Testa se a conexão ainda está viva (SELECT 1)."""
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        return True
    except Exception:
        return False


def get_conn() -> PgConnection:
    """Retorna conexão reutilizável ao Postgres (Neon).
    
    Reconecta automaticamente se a conexão SSL foi fechada pelo servidor
    (comum com Neon após idle timeout).
    """
    global _pool
    need_new = _pool is None or _pool.closed
    if not need_new:
        # Conexão existe mas pode estar morta (SSL closed)
        if not _is_alive(_pool):
            log.warning("Conexão PostgreSQL perdida (SSL idle), reconectando...")
            try:
                _pool.close()
            except Exception:
                pass
            need_new = True
    if need_new:
        database_url = os.environ["DATABASE_URL"]
        log.info("Conectando ao PostgreSQL...")
        _pool = psycopg2.connect(database_url, sslmode="require")
        _pool.autocommit = True
        log.info("✓ Conectado ao PostgreSQL (Neon)")
    return _pool


@contextmanager
def cursor():
    """Context manager para cursor com auto-close e retry em falha de conexão."""
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
        finally:
            cur.close()
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        # Conexão morreu durante uso — forçar reconexão e retry 1x
        log.warning(f"Erro de conexão durante query, reconectando: {e}")
        global _pool
        try:
            _pool.close()
        except Exception:
            pass
        _pool = None
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
        finally:
            cur.close()


def test_connection() -> bool:
    """Testa conexão no startup."""
    try:
        with cursor() as cur:
            cur.execute("SELECT 1")
        log.info("✓ Teste de conexão OK")
        return True
    except Exception as e:
        log.error(f"✗ Falha na conexão: {e}")
        return False


# ─── Types ────────────────────────────────────────────────────────────────────

class Fonte:
    def __init__(self, row: dict):
        self.id: str = row["id"]
        self.nome: str = row["nome"]
        self.url: str = row["url"]
        self.cidade: Optional[str] = row.get("cidade")
        self.estado: Optional[str] = row.get("estado")
        self.status: Optional[str] = row.get("status")

    def __repr__(self):
        return f"Fonte({self.nome!r}, {self.url!r})"


class ImovelInput:
    """Dados de um imóvel para upsert."""
    def __init__(
        self,
        url_anuncio: str,
        titulo: Optional[str] = None,
        tipo: Optional[str] = None,
        cidade: Optional[str] = None,
        bairro: Optional[str] = None,
        estado: Optional[str] = None,
        preco: Optional[float] = None,
        area_m2: Optional[float] = None,
        quartos: Optional[int] = None,
        banheiros: Optional[int] = None,
        vagas: Optional[int] = None,
        descricao: Optional[str] = None,
        imagens: Optional[list[str]] = None,
        caracteristicas: Optional[dict] = None,
        transacao: Optional[str] = None,
    ):
        self.url_anuncio = url_anuncio
        self.titulo = titulo
        self.tipo = tipo
        self.cidade = cidade
        self.bairro = bairro
        self.estado = estado
        self.preco = preco
        self.area_m2 = area_m2
        self.quartos = quartos
        self.banheiros = banheiros
        self.vagas = vagas
        self.descricao = descricao
        self.imagens = imagens or []
        self.caracteristicas = caracteristicas or {}
        self.transacao = transacao

    @property
    def fields_count(self) -> int:
        """Quantos campos preenchidos (excluindo url_anuncio)."""
        count = 0
        if self.titulo: count += 1
        if self.tipo: count += 1
        if self.preco and self.preco > 0: count += 1
        if self.area_m2 and self.area_m2 > 0: count += 1
        if self.quartos and self.quartos > 0: count += 1
        if self.bairro: count += 1
        if self.cidade: count += 1
        return count

    def __repr__(self):
        return f"Imovel({self.titulo or self.url_anuncio[:40]}, R${self.preco})"


# ─── Queries ──────────────────────────────────────────────────────────────────

def get_fonte_by_id(fonte_id: str) -> Optional[Fonte]:
    """Busca fonte pelo ID."""
    with cursor() as cur:
        cur.execute("SELECT * FROM fontes WHERE id = %s", (fonte_id,))
        row = cur.fetchone()
        return Fonte(row) if row else None


def update_fonte_status(fonte_id: str, status: str, erro: Optional[str] = None) -> None:
    """Atualiza status da fonte."""
    with cursor() as cur:
        if status == "ok":
            cur.execute(
                "UPDATE fontes SET status = %s, crawl_erro = %s, last_crawl = NOW() WHERE id = %s",
                (status, None, fonte_id),
            )
        else:
            cur.execute(
                "UPDATE fontes SET status = %s, crawl_erro = %s WHERE id = %s",
                (status, erro, fonte_id),
            )
    log.info(f"Status fonte {fonte_id[:8]}... → {status}")


def upsert_imoveis(fonte_id: str, items: list[ImovelInput]) -> int:
    """
    Upsert batch de imóveis no banco.
    ON CONFLICT(url_anuncio) → atualiza todos os campos.
    Retorna quantos foram salvos.
    """
    if not items:
        return 0

    saved = 0
    CHUNK = 10

    for i in range(0, len(items), CHUNK):
        chunk = items[i : i + CHUNK]
        try:
            with cursor() as cur:
                for item in chunk:
                    cur.execute(
                        """
                        INSERT INTO imoveis (
                            fonte_id, url_anuncio, titulo, tipo, transacao, cidade, bairro, estado,
                            preco, area_m2, quartos, banheiros, vagas,
                            descricao, imagens, caracteristicas, disponivel, updated_at
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s, %s::jsonb, true, NOW()
                        )
                        ON CONFLICT (url_anuncio) DO UPDATE SET
                            titulo = COALESCE(EXCLUDED.titulo, imoveis.titulo),
                            tipo = COALESCE(EXCLUDED.tipo, imoveis.tipo),
                            transacao = COALESCE(EXCLUDED.transacao, imoveis.transacao),
                            cidade = COALESCE(EXCLUDED.cidade, imoveis.cidade),
                            bairro = COALESCE(EXCLUDED.bairro, imoveis.bairro),
                            estado = COALESCE(EXCLUDED.estado, imoveis.estado),
                            preco = COALESCE(EXCLUDED.preco, imoveis.preco),
                            area_m2 = COALESCE(EXCLUDED.area_m2, imoveis.area_m2),
                            quartos = EXCLUDED.quartos,
                            banheiros = EXCLUDED.banheiros,
                            vagas = EXCLUDED.vagas,
                            descricao = COALESCE(EXCLUDED.descricao, imoveis.descricao),
                            imagens = CASE WHEN EXCLUDED.imagens IS NOT NULL AND array_length(EXCLUDED.imagens, 1) > 0 THEN EXCLUDED.imagens ELSE imoveis.imagens END,
                            caracteristicas = COALESCE(EXCLUDED.caracteristicas, imoveis.caracteristicas),
                            disponivel = true,
                            updated_at = NOW()
                        """,
                        (
                            fonte_id,
                            item.url_anuncio,
                            item.titulo,
                            item.tipo,
                            item.transacao,
                            item.cidade,
                            item.bairro,
                            item.estado,
                            str(item.preco) if item.preco is not None else None,
                            str(item.area_m2) if item.area_m2 is not None else None,
                            item.quartos,
                            item.banheiros,
                            item.vagas,
                            item.descricao,
                            item.imagens,
                            json.dumps(item.caracteristicas),
                        ),
                    )
                    saved += 1
        except Exception as e:
            log.error(f"✗ Upsert falhou (chunk {i}-{i + CHUNK}): {e}")
            raise

    return saved


def reset_stuck_crawling_fontes() -> int:
    """
    Reseta fontes presas em status='crawling' (worker foi reiniciado).
    Chamado no startup para evitar o frontend ficar preso em polling infinito.
    """
    stuck_progress = json.dumps({
        "fase": "erro",
        "message": "Worker reiniciado — crawl interrompido. Clique em Sincronizar para reiniciar.",
        "done": 0, "total": 0, "pct": 0,
        "enriched": 0, "failed": 0,
        "elapsed": "0s", "logs": [],
        "finished": True,
    }, ensure_ascii=False)
    with cursor() as cur:
        cur.execute(
            "UPDATE fontes SET status = 'erro', crawl_erro = %s, crawl_progress = %s::jsonb "
            "WHERE status = 'crawling'",
            ("Worker reiniciado — crawl interrompido", stuck_progress),
        )
        count = cur.rowcount
    if count > 0:
        log.warning(f"⚠ {count} fonte(s) resetada(s): estavam em 'crawling' ao reiniciar")
    return count


def update_crawl_progress(fonte_id: str, progress_data: dict) -> None:
    """Atualiza o progresso do crawl no banco para polling do frontend."""
    with cursor() as cur:
        cur.execute(
            "UPDATE fontes SET crawl_progress = %s::jsonb WHERE id = %s",
            (json.dumps(progress_data, ensure_ascii=False), fonte_id),
        )


def mark_imoveis_indisponiveis(fonte_id: str, urls_ativas: list[str]) -> int:
    """Marca imóveis que não estão mais na listagem como indisponíveis."""
    if not urls_ativas:
        return 0

    with cursor() as cur:
        # Busca todos os imóveis da fonte
        cur.execute(
            "SELECT id, url_anuncio FROM imoveis WHERE fonte_id = %s",
            (fonte_id,),
        )
        all_rows = cur.fetchall()

    active_set = set(urls_ativas)
    ids_to_disable = [row["id"] for row in all_rows if row["url_anuncio"] not in active_set]

    if ids_to_disable:
        with cursor() as cur:
            for imovel_id in ids_to_disable:
                cur.execute(
                    "UPDATE imoveis SET disponivel = false, updated_at = NOW() WHERE id = %s",
                    (imovel_id,),
                )

    log.info(f"Marcados {len(ids_to_disable)} imóveis como indisponíveis")
    return len(ids_to_disable)
