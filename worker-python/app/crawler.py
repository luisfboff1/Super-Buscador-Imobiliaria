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
MAX_ENRICH = int(os.environ.get("CRAWL_MAX_ENRICH", "10"))  # 10 para teste, 0 = todos
CONCURRENCY = int(os.environ.get("CRAWL_CONCURRENCY", "3"))

# ─── Filtros de URL ───────────────────────────────────────────────────────────

# Filtros para DETALHE de imóvel — URLs que NÃO são páginas de detalhe
SKIP_URL_PATTERNS = [
    re.compile(p, re.I) for p in [
        # Páginas institucionais
        r"/(contato|sobre|blog|faq|politica|termos|privacidade|quem-somos)",
        r"/(login|cadastro|admin|painel|area-do-cliente|minha-conta)",
        r"/(listar|comparar|favorit)",
        r"/(trabalhe|carreiras|equipe|corretor)",
        r"/(plantao|atendimento|simulador|financiamento)",
        r"/(anuncie|anunciar|anuncie-o-seu|anuncie-seu|publicar)",
        # Listagens genéricas / Paginação
        r"/imoveis(/|$)",
        r"/(page|pagina|pag)/\d+",
        r"[?&](page|pagina|pag)=\d+",
        # Anchors e arquivos estáticos
        r"/#",
        r"\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|webp|mp4|xml)(\?|$)",
    ]
]

# Padrões adicionais de listagem (usados SOMENTE no filtro de detalhe,
# não na descoberta/paginação). Detectamos listagem vs detalhe.
LISTING_PATH_PATTERNS = [
    re.compile(p, re.I) for p in [
        # /comprar/cidade/caxias-do-sul/1/  (listagem paginada)
        r"/(comprar|venda|alugar|aluguel)/(cidade|bairro|tipo|regiao)/",
        # /comprar  /venda  /alugar  (raiz de listagem, sem slug de imóvel)
        r"^/(comprar|venda|alugar|aluguel)/?$",
    ]
]

RENTAL_URL_PATTERNS = [
    re.compile(p, re.I) for p in [
        r"alug(ar|uel)",
        r"locac(ao|ão)",
        r"para[_-]?alug",
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

    path = urlparse(url).path
    if not path or path == "/":
        return False

    if any(p.search(url) for p in SKIP_URL_PATTERNS):
        return False
    if any(p.search(url) for p in RENTAL_URL_PATTERNS):
        return False
    # Páginas de listagem por cidade/tipo NÃO são detalhe
    if any(p.search(path) for p in LISTING_PATH_PATTERNS):
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


def safe_html(page) -> str:
    """Extrai HTML da página com fallback seguro para encoding."""
    try:
        return str(page.html_content)
    except (UnicodeDecodeError, Exception):
        pass
    try:
        raw = page.body
        if isinstance(raw, bytes):
            return raw.decode("utf-8", errors="replace")
        return str(raw)
    except Exception:
        return ""


def has_real_content(page) -> bool:
    """Verifica se a página tem conteúdo real de imóveis."""
    try:
        text = page.get_all_text() if hasattr(page, "get_all_text") else str(page.text or "")
        text_lower = str(text).lower()
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

# Fallback — tentamos esses se o LLM não achar nada
LISTING_CANDIDATES_SUFFIXES = [
    "/imoveis/venda",
    "/imoveis/comprar",
    "/comprar",
    "/venda",
    "/imoveis?finalidade=venda",
    "/imoveis?tipo=venda",
    "/imoveis",
]

# Regex para achar link da página 2 no HTML
PAGINATION_PATTERNS_PAGE2 = [
    r'href=["\']([^"\']*(?:pagina|page|pag|pg)[=/]2[^"\']*)["\']',
    r'href=["\']([^"\']*[?&](?:pagina|page|pag|pg)=2[^"\']*)["\']',
]


def _llm_find_listing_url(html: str, site_url: str, on_progress: Optional[Callable] = None) -> Optional[str]:
    """
    Usa LLM para analisar a homepage e descobrir a URL de listagem de imóveis à venda.
    Cada site tem uma estrutura diferente — o LLM entende o contexto.
    """
    from bs4 import BeautifulSoup

    progress = on_progress or log.info
    soup = BeautifulSoup(html, "lxml")
    base_hostname = urlparse(site_url).hostname or ""

    # Coletar todos os links com texto
    links_info = []
    seen_hrefs = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("/"):
            href = f"https://{base_hostname}{href}"
        if not href.startswith("http"):
            continue
        if href in seen_hrefs:
            continue
        seen_hrefs.add(href)

        text = a.get_text(strip=True)[:80]
        if text or any(kw in href.lower() for kw in ["imov", "comprar", "venda", "alug"]):
            links_info.append(f"- {href}  ({text})")

    if not links_info:
        return None

    # Limitar para não exceder tokens
    links_text = "\n".join(links_info[:100])

    prompt = f"""Analise os links desta homepage de um site imobiliário e identifique a URL principal
que lista imóveis À VENDA (não aluguel).

Site: {site_url}

Links encontrados:
{links_text}

REGRAS:
- Retorne SOMENTE a URL completa (uma única linha, nada mais).
- Escolha a URL que mostra a LISTAGEM de imóveis à venda (não um imóvel específico).
- Prefira URLs com "comprar", "venda", "imoveis" no path.
- Se houver filtro por cidade, escolha o mais genérico possível.
- Se nenhuma URL parece ser uma listagem de venda, retorne "NONE".
"""

    try:
        from app.extractor import _llm_chat
        answer = _llm_chat(
            messages=[
                {"role": "system", "content": "Você é um assistente que analisa sites imobiliários. Responda SOMENTE com a URL, sem explicação."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=200,
        )

        if not answer:
            progress(f"  LLM não retornou resposta")
            return None

        answer = answer.strip('"\'` \n')

        if "NONE" in answer.upper() or not answer.startswith("http"):
            progress(f"  LLM não encontrou listagem de venda")
            return None

        progress(f"  🤖 LLM identificou listagem: {answer}")
        return answer

    except Exception as e:
        log.warning(f"LLM discovery falhou: {e}")
        return None


def discover_property_urls(
    site_url: str,
    on_progress: Optional[Callable[[str], None]] = None,
) -> list[str]:
    """
    Descobre todas as URLs de imóveis à venda de um site imobiliário.
    
    1. Usa LLM para entender a homepage e encontrar a listagem de venda
    2. Fallback: testa URLs comuns (hardcoded)
    3. Detecta paginação (query param OU path-based)
    4. Navega todas as páginas coletando links de detalhe
    """
    progress = on_progress or log.info
    base_url = site_url.rstrip("/")
    base_hostname = urlparse(site_url).hostname or ""
    all_detail_urls: set[str] = set()

    # ── 1. Encontrar a melhor URL de listagem ────────────────────────────────
    progress(f"{'─'*50}")
    progress(f"FASE 1: Procurando listagem de venda (LLM + fallback)")
    progress(f"Site: {base_url}")
    progress(f"{'─'*50}")

    best_url: Optional[str] = None
    best_count = 0
    used_stealth = False

    # 1a. Fetch homepage e pedir LLM para encontrar a listagem
    progress(f"  Buscando homepage: {base_url}")
    homepage = fetch_page(base_url, stealth=False)
    if homepage and not has_real_content(homepage):
        progress(f"  ↳ Homepage sem conteúdo, tentando stealth...")
        homepage = fetch_page(base_url, stealth=True)
        if homepage:
            used_stealth = True

    if homepage:
        homepage_html = safe_html(homepage)

        # Perguntar ao LLM qual é a URL de listagem
        progress(f"  🤖 Perguntando ao LLM qual é a listagem de venda...")
        llm_listing_url = _llm_find_listing_url(homepage_html, site_url, on_progress=progress)

        if llm_listing_url:
            # Testar a URL que o LLM sugeriu
            progress(f"  Testando URL do LLM: {llm_listing_url}")
            llm_page = fetch_page(llm_listing_url, stealth=used_stealth)
            if llm_page:
                links = extract_detail_links(llm_page, base_hostname)
                progress(f"  ↳ {len(links)} imóveis encontrados")
                if len(links) >= 1:
                    best_url = llm_listing_url
                    best_count = len(links)

    # 1b. Fallback: tentar URLs hardcoded se LLM não achou
    if not best_url or best_count < 3:
        progress(f"  Fallback: testando URLs comuns...")
        for suffix in LISTING_CANDIDATES_SUFFIXES:
            candidate = f"{base_url}{suffix}"
            progress(f"    Tentando: {candidate}")

            page = fetch_page(candidate, stealth=False)
            if page and not has_real_content(page):
                page = fetch_page(candidate, stealth=True)
                if page:
                    used_stealth = True

            if not page:
                continue

            links = extract_detail_links(page, base_hostname)
            progress(f"    ↳ {len(links)} imóveis")

            if len(links) > best_count:
                best_count = len(links)
                best_url = candidate

            if len(links) >= 5:
                break

    if not best_url or best_count < 1:
        progress("✗ Nenhuma listagem de venda encontrada")
        return []

    progress(f"✓ Melhor listagem: {best_url} ({best_count} imóveis na pág 1)")

    # ── 2. Paginação ─────────────────────────────────────────────────────────
    progress(f"\n{'─'*50}")
    progress(f"FASE 2: Paginação")
    progress(f"{'─'*50}")

    page = fetch_page(best_url, stealth=used_stealth)
    if page:
        for link in extract_detail_links(page, base_hostname):
            all_detail_urls.add(link)

    # Detectar paginação
    page2_url = _detect_page2_url(page, best_url, base_hostname)

    if not page2_url:
        progress(f"  Sem paginação detectada — {len(all_detail_urls)} imóveis total")
        return list(all_detail_urls)

    # Converter URL da pág 2 em template
    template = _url_to_template(page2_url)
    if template:
        progress(f"  Template de paginação: {template}")
    else:
        progress(f"  Paginação detectada mas sem template — parando")
        return list(all_detail_urls)

    # ── 3. Navegar todas as páginas ──────────────────────────────────────────
    empty_pages = 0
    page_num = 2

    while page_num <= MAX_PAGES and empty_pages < 2:
        page_url = template.replace("{N}", str(page_num))

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

    html = safe_html(page)

    # 1. Buscar link para página 2 via regex no HTML (query params)
    for pattern in PAGINATION_PATTERNS_PAGE2:
        match = re.search(pattern, html, re.I)
        if match:
            href = match.group(1)
            if href.startswith("/"):
                href = f"https://{base_hostname}{href}"
            log.info(f"  Paginação encontrada (regex): {href}")
            return href

    # 2. Buscar via seletores CSS (query params)
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
                    log.info(f"  Paginação encontrada (CSS): {href}")
                    return href
    except Exception:
        pass

    # 3. Path-based pagination: a listing URL termina com /N/ (ex: /comprar/cidade/caxias/1/)
    #    Tentar trocar o último segmento numérico por "2"
    parsed = urlparse(listing_url)
    path = parsed.path.rstrip("/")
    segments = path.split("/")
    
    # Caso: URL termina com número (ex: /comprar/cidade/caxias-do-sul/1)
    if segments and re.match(r"^\d+$", segments[-1]):
        segments[-1] = "2"
        page2_path = "/".join(segments) + "/"
        page2_url = f"https://{base_hostname}{page2_path}"
        log.info(f"  Tentando paginação path-based: {page2_url}")
        page2 = fetch_page(page2_url, stealth=False)
        if page2:
            links = extract_detail_links(page2, base_hostname)
            if links:
                log.info(f"  ✓ Paginação path-based funcionou: {len(links)} imóveis na pág 2")
                return page2_url

    # 4. Tentar ADICIONAR /2/ no final (ex: /comprar/cidade/caxias-do-sul → .../2/)
    probe_url = f"{listing_url.rstrip('/')}/2/"
    log.debug(f"  Probe append /2/: {probe_url}")
    page2 = fetch_page(probe_url, stealth=False)
    if page2:
        links = extract_detail_links(page2, base_hostname)
        if links:
            log.info(f"  ✓ Paginação path-append funcionou: {len(links)} imóveis na pág 2")
            return probe_url

    # 5. Probe: tentar padrões comuns de query string
    probe_patterns = [
        f"{listing_url}?pagina=2",
        f"{listing_url}?page=2",
    ]
    for probe_url in probe_patterns:
        page2 = fetch_page(probe_url, stealth=False)
        if page2:
            links = extract_detail_links(page2, base_hostname)
            if links:
                log.info(f"  ✓ Paginação probe funcionou: {probe_url}")
                return probe_url

    return None


def _url_to_template(page2_url: str) -> Optional[str]:
    """Converte URL da pág 2 em template com {N}."""
    # Query-based patterns
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

    # Path-based: último segmento é "2" → trocar por {N}
    # Ex: /comprar/cidade/caxias-do-sul/2/ → /comprar/cidade/caxias-do-sul/{N}/
    parsed = urlparse(page2_url)
    path = parsed.path.rstrip("/")
    segments = path.split("/")
    if segments and segments[-1] == "2":
        segments[-1] = "{N}"
        new_path = "/".join(segments) + "/"
        template = f"{parsed.scheme}://{parsed.netloc}{new_path}"
        if parsed.query:
            template += f"?{parsed.query}"
        return template

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

    html = safe_html(page)

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

    # ── FASE 2: Enriquecimento (só salva quem tem dados) ──────────
    urls_to_enrich = urls[:MAX_ENRICH] if MAX_ENRICH > 0 else urls
    total = len(urls_to_enrich)

    # Tracking de qualidade
    complete_items: list[str] = []    # preço + tipo + localização
    incomplete_items: list[str] = []  # parcial
    failed_urls: list[str] = []        # erro ou sem dados
    enriched_urls: list[str] = []      # todos enriquecidos com sucesso

    progress(f"\n{'─'*50}")
    if MAX_ENRICH > 0:
        progress(f"FASE 2: Enriquecimento (limitado: {total}/{len(urls)})")
    else:
        progress(f"FASE 2: Enriquecimento ({total} imóveis)")
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
                    enriched_urls.append(url)
                    # Classificar qualidade: preço + tipo + localização = completo
                    has_preco = data.preco is not None and data.preco > 0
                    has_tipo = bool(data.tipo)
                    has_local = bool(data.bairro or data.cidade)
                    if has_preco and has_tipo and has_local:
                        complete_items.append(url)
                    else:
                        faltando = []
                        if not has_preco: faltando.append("preço")
                        if not has_tipo: faltando.append("tipo")
                        if not has_local: faltando.append("localização")
                        incomplete_items.append(f"{url} (falta: {', '.join(faltando)})")
                else:
                    stats.failed += 1
                    failed_urls.append(url)
            except Exception as e:
                log.error(f"  ✗ Erro {url}: {e}")
                stats.failed += 1
                failed_urls.append(f"{url} ({e})")
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

    # ── FASE 3: Marcar indisponíveis ──────────────────
    progress(f"\n{'─'*50}")
    progress(f"FASE 3: Marcando imóveis indisponíveis")
    progress(f"{'─'*50}")

    disabled = mark_imoveis_indisponiveis(fonte_id, urls)
    progress(f"✓ {disabled} imóveis marcados como indisponíveis")

    # ── RELATÓRIO FINAL ───────────────────────────────
    n_complete = len(complete_items)
    n_incomplete = len(incomplete_items)
    n_failed = len(failed_urls)

    progress(f"\n{'='*60}")
    progress(f"  RELATÓRIO FINAL — {site_url}")
    progress(f"{'='*60}")
    progress(f"  URLs descobertas: {stats.urls_found}")
    progress(f"  Processados:      {total}")
    progress(f"  Tempo total:      {stats.elapsed_str}")
    progress(f"{'─'*50}")
    progress(f"  ✅ Completos (preço+tipo+local): {n_complete}")
    progress(f"  ⚠️  Incompletos:                 {n_incomplete}")
    progress(f"  ❌ Erros/sem dados:              {n_failed}")
    progress(f"{'─'*50}")

    if incomplete_items:
        progress(f"\n  ⚠️  INCOMPLETOS ({n_incomplete}):")
        for item in incomplete_items:
            progress(f"    • {item}")

    if failed_urls:
        progress(f"\n  ❌ ERROS ({n_failed}):")
        for item in failed_urls[:20]:  # limitar output
            progress(f"    • {item}")
        if n_failed > 20:
            progress(f"    ... e mais {n_failed - 20}")

    if complete_items:
        progress(f"\n  ✅ COMPLETOS ({n_complete}):")
        for item in complete_items[:20]:
            progress(f"    • {item}")
        if n_complete > 20:
            progress(f"    ... e mais {n_complete - 20}")

    progress(f"\n{'='*60}\n")

    return stats
