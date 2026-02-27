"""
Crawler de imobiliárias com Scrapling.

Fluxo:
1. DESCOBERTA: Achar a melhor URL de listagem de venda
2. PAGINAÇÃO: Navegar todas as páginas da listagem, coletando URLs de detalhe
3. ENRIQUECIMENTO: Abrir cada URL de detalhe e extrair dados do imóvel

Scrapling fornece:
- StealthyFetcher: bypass de Cloudflare/Turnstile automaticamente
- Fetcher: HTTP requests rápidos para sites SSR simples
- Parser adaptativo: seletores CSS que sobrevivem a mudanças de layout
"""

import os
import re
import asyncio
import time
from typing import Optional, Callable
from urllib.parse import urljoin, urlparse

from scrapling.fetchers import Fetcher, StealthyFetcher

from app.db import ImovelInput
from app.extractor import extract_property_data, extract_images
from app.logger import get_logger

log = get_logger("crawler")

# ─── Configuração ─────────────────────────────────────────────────────────────

MAX_PAGES = int(os.environ.get("CRAWL_MAX_PAGES", "200"))
MAX_ENRICH = int(os.environ.get("CRAWL_MAX_ENRICH", "0"))
CONCURRENCY = int(os.environ.get("CRAWL_CONCURRENCY", "3"))

# ─── Filtros de URL ───────────────────────────────────────────────────────────

SKIP_URL_PATTERNS = [
    re.compile(p, re.I) for p in [
        r"/(contato|sobre|blog|faq|politica|termos|privacidade|quem-somos)",
        r"/(login|cadastro|admin|painel|area-do-cliente|minha-conta)",
        r"/(listar|comparar|favorit)",
        r"/(trabalhe|carreiras|equipe|corretor)",
        r"/(plantao|atendimento|simulador|financiamento)",
        r"/imoveis(/|$)",
        r"/(page|pagina|pag)/\d+",
        r"[?&](page|pagina|pag)=\d+",
        r"/#",
        r"\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|webp|mp4|xml)(\?|$)",
    ]
]

RENTAL_URL_PATTERNS = [
    re.compile(p, re.I) for p in [
        r"/alug(ar|uel)",
        r"/locac(ao|ão)",
        r"[?&]finalidade=alug",
    ]
]


def is_detail_page_url(url: str, base_hostname: str) -> bool:
    """Detecta se uma URL é uma página de detalhe de imóvel."""
    try:
        parsed = urlparse(url)
        if parsed.hostname != base_hostname:
            return False
    except Exception:
        return False

    if any(p.search(url) for p in SKIP_URL_PATTERNS):
        return False
    if any(p.search(url) for p in RENTAL_URL_PATTERNS):
        return False

    path = urlparse(url).path
    if not path or path == "/":
        return False

    segments = [s for s in path.split("/") if s]

    # ID numérico no path (/imovel/1234)
    if any(re.match(r"^\d+$", s) for s in segments):
        return True
    # Slug longo com hífens (/apartamento-2-quartos-centro)
    if any(len(s) > 15 and "-" in s for s in segments):
        return True
    # 3+ segmentos (/imoveis/venda/apt-xyz)
    if len(segments) >= 3:
        return True
    # Referência (ref-123, cod-456)
    if re.search(r"\b(ref|cod|id)[-_]?\d+", path, re.I):
        return True

    return False


# ─── Fetch helpers ────────────────────────────────────────────────────────────

def fetch_page(url: str, stealth: bool = False) -> Optional[object]:
    """
    Faz fetch de uma página.
    
    - stealth=False: Fetcher rápido (HTTP, sem browser)
    - stealth=True: StealthyFetcher (Playwright stealth, bypass Cloudflare)
    """
    try:
        if stealth:
            log.debug(f"Fetch stealth: {url}")
            page = StealthyFetcher.fetch(
                url,
                headless=True,
                network_idle=True,
                timeout=30000,
                disable_resources=True,
            )
        else:
            log.debug(f"Fetch rápido: {url}")
            page = Fetcher.get(
                url,
                stealthy_headers=True,
                timeout=15,
            )
        return page
    except Exception as e:
        log.warning(f"Fetch falhou ({url}): {e}")
        return None


def has_real_content(page) -> bool:
    """Verifica se a página tem conteúdo real de imóveis."""
    try:
        text = page.get_all_text() if hasattr(page, "get_all_text") else str(page.text or "")
        text_lower = text.lower()
        keywords = ["apartamento", "m²", "r$", "imovel", "imóvel", "venda", "quartos"]
        return any(k in text_lower for k in keywords)
    except Exception:
        return False


def extract_detail_links(page, base_hostname: str) -> list[str]:
    """Extrai links de detalhe de imóveis de uma página de listagem."""
    try:
        all_links = page.css("a[href]")
        urls = set()
        for link in all_links:
            href = link.attrib.get("href", "")
            if not href or href == "#":
                continue
            # Resolve relative URLs
            if href.startswith("/"):
                href = f"https://{base_hostname}{href}"
            elif not href.startswith("http"):
                continue
            if is_detail_page_url(href, base_hostname):
                urls.add(href)
        return list(urls)
    except Exception as e:
        log.warning(f"Erro extraindo links: {e}")
        return []


# ─── Discovery: encontrar URLs de imóveis ────────────────────────────────────

LISTING_CANDIDATES_SUFFIXES = [
    "/imoveis/venda",
    "/imoveis/comprar",
    "/comprar",
    "/venda",
    "/imoveis?finalidade=venda",
    "/imoveis?tipo=venda",
    "/imoveis",
    "",  # homepage como último recurso
]

PAGINATION_PATTERNS_PAGE2 = [
    r'href=["\']([^"\']*(?:pagina|page|pag|pg)[=/]2[^"\']*)["\']',
    r'href=["\']([^"\']*[?&](?:pagina|page|pag|pg)=2[^"\']*)["\']',
]


def discover_property_urls(
    site_url: str,
    on_progress: Optional[Callable[[str], None]] = None,
) -> list[str]:
    """
    Descobre todas as URLs de imóveis à venda de um site imobiliário.
    
    1. Testa várias URLs de listagem e escolhe a melhor
    2. Detecta paginação
    3. Navega todas as páginas coletando links de detalhe
    """
    progress = on_progress or log.info
    base_url = site_url.rstrip("/")
    base_hostname = urlparse(site_url).hostname or ""
    all_detail_urls: set[str] = set()

    # ── 1. Encontrar a melhor URL de listagem ────────────────────────────────
    progress(f"{'─'*50}")
    progress(f"FASE 1: Procurando melhor listagem de venda")
    progress(f"Site: {base_url}")
    progress(f"{'─'*50}")

    best_url: Optional[str] = None
    best_count = 0
    used_stealth = False

    for suffix in LISTING_CANDIDATES_SUFFIXES:
        candidate = f"{base_url}{suffix}" if suffix else base_url
        progress(f"  Tentando: {candidate}")
        
        # Tenta HTTP rápido primeiro
        page = fetch_page(candidate, stealth=False)
        
        # Se não tem conteúdo real, tenta stealth
        if page and not has_real_content(page):
            progress(f"  ↳ Sem conteúdo real, tentando stealth...")
            page = fetch_page(candidate, stealth=True)
            if page:
                used_stealth = True

        if not page:
            progress(f"  ↳ ✗ Sem resposta")
            continue

        links = extract_detail_links(page, base_hostname)
        progress(f"  ↳ {len(links)} imóveis encontrados")

        if len(links) > best_count:
            best_count = len(links)
            best_url = candidate

        # Preferir URL específica (não homepage) com pelo menos 5 links
        if len(links) >= 5 and suffix:
            break
        if len(links) >= 30:
            break

    if not best_url or best_count < 1:
        progress("✗ Nenhuma listagem de venda encontrada")
        return []

    progress(f"✓ Melhor listagem: {best_url} ({best_count} imóveis na pág 1)")

    # ── 2. Fetch primeira página e coletar links ─────────────────────────────
    progress(f"\n{'─'*50}")
    progress(f"FASE 2: Paginação")
    progress(f"{'─'*50}")

    page = fetch_page(best_url, stealth=used_stealth)
    if page:
        for link in extract_detail_links(page, base_hostname):
            all_detail_urls.add(link)

    # Detectar URL da página 2
    page2_url = _detect_page2_url(page, best_url, base_hostname)

    if not page2_url:
        progress(f"  Sem paginação detectada — {len(all_detail_urls)} imóveis total")
        return list(all_detail_urls)

    # Converter URL da pág 2 em template
    template = _url_to_template(page2_url)
    if template:
        progress(f"  Template de paginação: {template}")
    else:
        progress(f"  Paginação detectada mas sem template — usando sequencial")

    # ── 3. Navegar todas as páginas ──────────────────────────────────────────
    empty_pages = 0
    page_num = 2

    while page_num <= MAX_PAGES and empty_pages < 2:
        if template:
            page_url = template.replace("{N}", str(page_num))
        else:
            page_url = page2_url  # fallback
            break

        page = fetch_page(page_url, stealth=used_stealth)
        if not page:
            progress(f"  Pág {page_num}: ✗ sem resposta, parando")
            break

        links = extract_detail_links(page, base_hostname)
        new_links = [l for l in links if l not in all_detail_urls]

        if not new_links:
            empty_pages += 1
            progress(f"  Pág {page_num}: 0 novos ({empty_pages}/2 vazias)")
        else:
            empty_pages = 0
            for l in links:
                all_detail_urls.add(l)
            progress(f"  Pág {page_num}: +{len(new_links)} novos (total: {len(all_detail_urls)})")

        page_num += 1

    progress(f"\n✓ Descoberta concluída: {len(all_detail_urls)} URLs em {page_num - 1} páginas")
    return list(all_detail_urls)


def _detect_page2_url(page, listing_url: str, base_hostname: str) -> Optional[str]:
    """Detecta o URL da página 2 da paginação."""
    if not page:
        return None

    try:
        html = str(page.html_content) if hasattr(page, "html_content") else str(page.body or "")
    except Exception:
        html = ""

    # Buscar link para página 2 via regex no HTML
    for pattern in PAGINATION_PATTERNS_PAGE2:
        match = re.search(pattern, html, re.I)
        if match:
            href = match.group(1)
            if href.startswith("/"):
                href = f"https://{base_hostname}{href}"
            return href

    # Buscar via seletores CSS
    pagination_selectors = [
        'a[href*="pagina=2"]', 'a[href*="page=2"]', 'a[href*="pag=2"]',
        'a[href*="/pagina/2"]', 'a[href*="/page/2"]', 'a[href*="/pag/2"]',
    ]
    try:
        for sel in pagination_selectors:
            results = page.css(sel)
            if results:
                href = results[0].attrib.get("href", "")
                if href:
                    if href.startswith("/"):
                        href = f"https://{base_hostname}{href}"
                    return href
    except Exception:
        pass

    # Probe: tentar padrões comuns
    probe_patterns = [
        f"{listing_url}?pagina=2",
        f"{listing_url}?page=2",
        f"{listing_url}/pagina/2",
        f"{listing_url}/page/2",
    ]
    for probe_url in probe_patterns:
        page2 = fetch_page(probe_url, stealth=False)
        if page2:
            links = extract_detail_links(page2, base_hostname)
            if links:
                return probe_url

    return None


def _url_to_template(page2_url: str) -> Optional[str]:
    """Converte URL da pág 2 em template com {N}."""
    replacements = [
        (r"([?&]pagina=)2(&|$)", r"\g<1>{N}\g<2>"),
        (r"([?&]page=)2(&|$)", r"\g<1>{N}\g<2>"),
        (r"([?&]pag=)2(&|$)", r"\g<1>{N}\g<2>"),
        (r"([?&]pg=)2(&|$)", r"\g<1>{N}\g<2>"),
        (r"(/pagina/)2(/|$)", r"\g<1>{N}\g<2>"),
        (r"(/page/)2(/|$)", r"\g<1>{N}\g<2>"),
        (r"(/pag/)2(/|$)", r"\g<1>{N}\g<2>"),
        (r"(/pg/)2(/|$)", r"\g<1>{N}\g<2>"),
    ]
    for pattern, replacement in replacements:
        if re.search(pattern, page2_url):
            return re.sub(pattern, replacement, page2_url)
    return None


# ─── Enriquecimento: scrape cada página de detalhe ───────────────────────────

def scrape_property_page(
    url: str,
    fallback_cidade: Optional[str] = None,
    fallback_estado: Optional[str] = None,
) -> Optional[ImovelInput]:
    """
    Scrape de uma página de detalhe de imóvel.
    
    Cascata:
    1. Fetcher HTTP rápido (para sites SSR)
    2. StealthyFetcher (para sites com JS/Cloudflare)
    
    Depois extrai dados via JSON-LD → CSS → LLM.
    """
    start = time.time()

    # Tenta HTTP rápido primeiro
    page = fetch_page(url, stealth=False)
    source = "http"

    # Se sem conteúdo real → stealth
    if not page or not has_real_content(page):
        page = fetch_page(url, stealth=True)
        source = "stealth"

    if not page:
        log.warning(f"✗ Sem resposta — {url}")
        return None

    try:
        html = str(page.html_content) if hasattr(page, "html_content") else str(page.body or "")
    except Exception:
        html = ""

    if not html or len(html) < 200:
        log.warning(f"✗ HTML vazio — {url}")
        return None

    # Extrair dados via pipeline cascata
    result = extract_property_data(html, url, fallback_cidade, fallback_estado)

    elapsed = time.time() - start

    if result:
        log.info(
            f"✓ [{source}] {result.titulo or url[-30:]} — "
            + (f"R${result.preco:,.0f}" if result.preco else "s/preço")
            + f" — {result.bairro or '?'} ({elapsed:.1f}s)"
        )
    else:
        log.debug(f"✗ Sem dados [{source}] — {url} ({elapsed:.1f}s)")

    return result


# ─── Execução completa de um crawl ───────────────────────────────────────────

class CrawlStats:
    """Estatísticas de um crawl."""
    def __init__(self):
        self.urls_found = 0
        self.enriched = 0
        self.failed = 0
        self.skipped = 0
        self.by_method = {"json-ld": 0, "css": 0, "llm": 0}
        self.start_time = time.time()

    @property
    def elapsed_s(self) -> float:
        return time.time() - self.start_time

    @property
    def elapsed_str(self) -> str:
        s = self.elapsed_s
        if s < 60:
            return f"{s:.1f}s"
        return f"{s / 60:.1f}min"

    def summary(self) -> str:
        return (
            f"URLs: {self.urls_found} | "
            f"Enriquecidos: {self.enriched} | "
            f"Falhas: {self.failed} | "
            f"Tempo: {self.elapsed_str}"
        )


def execute_crawl(
    fonte_id: str,
    site_url: str,
    cidade: Optional[str],
    estado: Optional[str],
    on_progress: Optional[Callable[[str], None]] = None,
) -> CrawlStats:
    """
    Executa crawl completo de uma fonte.
    
    Retorna CrawlStats com métricas.
    """
    from app.db import upsert_imoveis, mark_imoveis_indisponiveis

    progress = on_progress or log.info
    stats = CrawlStats()

    # ── FASE 1: Descoberta ────────────────────────────
    progress(f"\n{'='*60}")
    progress(f"CRAWL INICIADO — {site_url}")
    progress(f"{'='*60}")

    urls = discover_property_urls(site_url, on_progress=progress)
    stats.urls_found = len(urls)

    if not urls:
        progress("Nenhum imóvel encontrado — finalizando")
        return stats

    # ── FASE 2: Salvar URLs base ───────────────────────
    progress(f"\n{'─'*50}")
    progress(f"FASE 3: Salvando {len(urls)} URLs base no banco")
    progress(f"{'─'*50}")

    base_items = [ImovelInput(url_anuncio=u, cidade=cidade, estado=estado) for u in urls]
    upsert_imoveis(fonte_id, base_items)
    progress(f"✓ {len(urls)} URLs salvas")

    # ── FASE 3: Enriquecimento ────────────────────────
    urls_to_enrich = urls[:MAX_ENRICH] if MAX_ENRICH > 0 else urls
    total = len(urls_to_enrich)

    progress(f"\n{'─'*50}")
    if MAX_ENRICH > 0:
        progress(f"FASE 4: Enriquecimento (limitado: {total}/{len(urls)})")
    else:
        progress(f"FASE 4: Enriquecimento ({total} imóveis)")
    progress(f"Concorrência: {CONCURRENCY}")
    progress(f"{'─'*50}")

    for i in range(0, total, CONCURRENCY):
        batch = urls_to_enrich[i : i + CONCURRENCY]
        batch_num = (i // CONCURRENCY) + 1
        total_batches = (total + CONCURRENCY - 1) // CONCURRENCY

        progress(f"\n  Batch {batch_num}/{total_batches} — {len(batch)} URLs")

        results: list[Optional[ImovelInput]] = []
        for url in batch:
            try:
                data = scrape_property_page(url, cidade, estado)
                results.append(data)
                if data:
                    stats.enriched += 1
                else:
                    stats.failed += 1
            except Exception as e:
                log.error(f"  ✗ Erro {url}: {e}")
                stats.failed += 1
                results.append(None)

        # Salvar batch imediatamente (progresso parcial)
        to_save = [r for r in results if r is not None]
        if to_save:
            upsert_imoveis(fonte_id, to_save)
            progress(
                f"  ✓ Batch {batch_num}: {len(to_save)} salvos "
                f"(total: {stats.enriched}/{total} | falhas: {stats.failed})"
            )

        # Progresso geral
        done = min(i + CONCURRENCY, total)
        pct = (done / total) * 100
        progress(f"  📊 Progresso: {done}/{total} ({pct:.0f}%) — {stats.elapsed_str}")

    # ── FASE 4: Marcar indisponíveis ──────────────────
    progress(f"\n{'─'*50}")
    progress(f"FASE 5: Marcando imóveis indisponíveis")
    progress(f"{'─'*50}")

    disabled = mark_imoveis_indisponiveis(fonte_id, urls)
    progress(f"✓ {disabled} imóveis marcados como indisponíveis")

    # ── Resumo final ──────────────────────────────────
    progress(f"\n{'='*60}")
    progress(f"✓ CRAWL CONCLUÍDO")
    progress(f"  Site: {site_url}")
    progress(f"  URLs descobertas: {stats.urls_found}")
    progress(f"  Enriquecidos: {stats.enriched}")
    progress(f"  Falhas: {stats.failed}")
    progress(f"  Tempo total: {stats.elapsed_str}")
    progress(f"{'='*60}\n")

    return stats
