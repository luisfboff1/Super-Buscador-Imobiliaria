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
import gc
import asyncio
import time
import threading
import traceback
from typing import Optional, Callable
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import psutil
from scrapling.fetchers import Fetcher, StealthyFetcher


# Catch unhandled thread exceptions
def _thread_excepthook(args):
    log.error(f"THREAD CRASH ({args.thread}): {args.exc_type.__name__}: {args.exc_value}")
    log.error(traceback.format_exception(args.exc_type, args.exc_value, args.exc_tb))

threading.excepthook = _thread_excepthook

from app.db import ImovelInput
from app.extractor import extract_property_data, extract_images, SiteTemplate
from app.logger import get_logger

log = get_logger("crawler")

# ─── Configuração ─────────────────────────────────────────────────────────────

MAX_PAGES = int(os.environ.get("CRAWL_MAX_PAGES", "200"))
MAX_ENRICH = int(os.environ.get("CRAWL_MAX_ENRICH", "0"))  # 0 = todos (sem limite)
CONCURRENCY = int(os.environ.get("CRAWL_CONCURRENCY", "2"))  # 2 paralelo (5 causava OOM em sites grandes como Balen 391 URLs)

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
        r"/imoveis/?(\?|#|$)",       # /imoveis sozinho (com ou sem query/hash)
        r"/-/-",                      # URLs com 2+ placeholders (filtros Antonella /-/-/tipo)
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
        # /imoveis/comprar  /imoveis/alugar  (listagem com prefixo /imoveis/)
        r"^/imoveis/(comprar|venda|alugar|aluguel)/?$",
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

    path = parsed.path
    if not path or path == "/":
        return False

    # ── STRONG POSITIVE: patterns que são DEFINITIVAMENTE detalhe ──
    # /imovel/12345 (singular, com ID numérico) — Antonella, Attuale, etc.
    if re.search(r"/imovel/\d+", path):
        return True
    # /imovel/slug-longo (singular, com slug)
    if re.search(r"/imovel/[a-z0-9][\w-]{5,}", path, re.I):
        return True
    # /imovel?code=123 ou /imovel?id=123 ou /imovel?ref=123 (query-string style — ex: Nichele)
    if re.search(r"/imovel\?(code|id|ref|cod)=\w+", parsed.geturl(), re.I):
        return True

    # ── SKIP: patterns que NÃO são detalhe ──
    if any(p.search(url) for p in SKIP_URL_PATTERNS):
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
    - stealth=True: StealthyFetcher (Playwright stealth)
    
    Stealth usa network_idle=False + wait=3000ms para evitar espera por
    analytics/trackers (economia de ~25s em sites pesados como Bassanesi)
    mas ainda dando tempo para SPAs renderizarem (Antonella, etc).
    Benchmarks: Bassanesi 33s→6.5s, Antonella 5.4s→6.5s (mesmos links).
    """
    try:
        if stealth:
            log.debug(f"Fetch stealth: {url}")
            page = StealthyFetcher.fetch(
                url,
                headless=True,
                network_idle=False,
                timeout=30000,
                wait=3000,
                disable_resources=False,
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


def fetch_page_with_scroll(url: str, max_scrolls: int = 50,
                           on_progress: Optional[Callable] = None) -> Optional[object]:
    """
    Faz fetch com Playwright e rola/clica 'Carregar mais' para carregar
    mais conteúdo (infinite scroll / lazy loading).
    
    Usa page_action do Scrapling (sync Playwright page object).
    """
    progress = on_progress or log.info
    
    def _scroll_action(page):
        """Sync automation function para page_action do Scrapling."""
        import time as _time
        
        prev_height = 0
        no_change_count = 0
        total_clicks = 0
        
        for i in range(max_scrolls):
            # Tentar clicar "Carregar mais" / "Load more" / "Ver mais"
            clicked = False
            for selector in [
                'button:has-text("Carregar mais")',
                'button:has-text("carregar mais")',
                'button:has-text("Ver mais")',
                'button:has-text("ver mais")',
                'button:has-text("Mostrar mais")',
                'button:has-text("Load more")',
                'a:has-text("Carregar mais")',
                'a:has-text("Ver mais")',
                '[class*="load-more"]',
                '[class*="loadmore"]',
            ]:
                try:
                    btn = page.locator(selector).first
                    if btn.is_visible(timeout=500):
                        btn.click()
                        clicked = True
                        total_clicks += 1
                        _time.sleep(2)  # Esperar AJAX
                        break
                except Exception:
                    continue
            
            if not clicked:
                # Scroll até o final
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                _time.sleep(2)
            
            # Verificar se novo conteúdo foi carregado
            new_height = page.evaluate("document.body.scrollHeight")
            if new_height == prev_height:
                no_change_count += 1
                if no_change_count >= 3:
                    break
            else:
                no_change_count = 0
            prev_height = new_height
        
        progress(f"    📜 Scroll: {i+1} iterações, {total_clicks} cliques (altura: {prev_height}px)")
    
    try:
        log.info(f"Fetch com scroll: {url}")
        page = StealthyFetcher.fetch(
            url,
            headless=True,
            network_idle=False,
            timeout=120000,
            wait=3000,
            disable_resources=False,
            page_action=_scroll_action,
        )
        return page
    except Exception as e:
        log.warning(f"Fetch com scroll falhou ({url}): {e}")
        return None


def fetch_page_with_js_pagination(
    url: str, base_hostname: str, max_pages: int = 50,
    on_progress: Optional[Callable] = None,
) -> set:
    """
    Faz fetch com Playwright e clica nos botões de paginação JavaScript
    (pages com <a href="#">) para coletar links de todas as páginas.

    Retorna set de URLs de detalhe encontrados em todas as páginas.
    """
    progress = on_progress or log.info
    collected_links: set = set()

    def _paginate_action(page):
        """Sync page_action: clica em cada botão de página."""
        import time as _time

        def _get_detail_links():
            """Extrai todos os hrefs do mesmo domínio — filtragem feita em Python."""
            raw = page.evaluate("""(hostname) => {
                const links = new Set();
                document.querySelectorAll('a[href]').forEach(a => {
                    try {
                        const href = a.href;
                        if (href && href.startsWith('http')) {
                            const url = new URL(href);
                            if (url.hostname === hostname || url.hostname.endsWith('.' + hostname)) {
                                const canonical = url.origin + url.pathname.replace(/\\/$/, '') + (url.search || '');
                                links.add(canonical);
                            }
                        }
                    } catch(e) {}
                });
                return Array.from(links);
            }""", base_hostname)
            # Filtra com a mesma lógica inteligente usada pelo resto do crawler
            return [l for l in raw if is_detail_page_url(l, base_hostname)]

        # Página 1 — aguardar AJAX da listagem carregar completamente
        # wait_for_load_state networkidle com timeout curto para não travar em analytics
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass  # timeout OK — continuamos com o que carregou
        _time.sleep(2)  # buffer extra para AJAX de cards de imóveis
        p1_links = _get_detail_links()
        for l in p1_links:
            collected_links.add(l)

        for pg in range(2, max_pages + 1):
            # Clicar no botão da página
            click_result = page.evaluate("""(pageNum) => {
                // Procurar no #pagination ou .pagination
                const containers = document.querySelectorAll('#pagination, .pagination, [class*=paginat], nav[aria-label*=paginat]');
                for (const container of containers) {
                    const links = container.querySelectorAll('a');
                    for (const a of links) {
                        const text = a.textContent.trim();
                        if (text === String(pageNum)) {
                            a.click();
                            return 'clicked';
                        }
                    }
                }
                // Tentar botão "próximo" / "»"
                for (const container of containers) {
                    const links = container.querySelectorAll('a');
                    for (const a of links) {
                        const text = a.textContent.trim();
                        if (text === '»' || text === '>' || text.toLowerCase().includes('próx') || text.toLowerCase().includes('next')) {
                            if (a.classList.contains('disabled') || a.getAttribute('disabled')) {
                                return 'disabled';
                            }
                            a.click();
                            return 'clicked_next';
                        }
                    }
                }
                return 'not_found';
            }""", pg)

            if click_result in ('not_found', 'disabled'):
                break

            # Aguardar AJAX da página seguinte carregar
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            _time.sleep(2)  # buffer extra

            pg_links = _get_detail_links()
            new_links = [l for l in pg_links if l not in collected_links]
            for l in pg_links:
                collected_links.add(l)

            if pg % 5 == 0:
                progress(f"    📄 JS paginação: pág {pg}, +{len(new_links)} novos (total: {len(collected_links)})")

            # Se 2 páginas consecutivas sem novos, parar
            if not new_links:
                # Tentar mais uma vez
                _time.sleep(1)
                pg_links2 = _get_detail_links()
                new2 = [l for l in pg_links2 if l not in collected_links]
                for l in pg_links2:
                    collected_links.add(l)
                if not new2:
                    break

        progress(f"    📄 JS paginação concluída: {pg} páginas, {len(collected_links)} links")

    try:
        log.info(f"Fetch com JS pagination: {url}")
        StealthyFetcher.fetch(
            url,
            headless=True,
            network_idle=True,    # precisa esperar AJAX da listagem carregar
            timeout=180000,
            wait=3000,            # buffer adicional após network idle
            disable_resources=False,
            page_action=_paginate_action,
        )
        return collected_links
    except Exception as e:
        log.warning(f"Fetch com JS pagination falhou ({url}): {e}")
        return collected_links  # Retorna o que conseguiu coletar


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


def _find_pagination_in_dom(page, listing_url: str, base_hostname: str) -> Optional[tuple[str, int]]:
    """
    Procura links/botões de paginação no DOM renderizado (Playwright).
    Captura o padrão REAL de paginação, incluindo:
      - <a href> com query param de paginação
      - <button> dentro de containers de paginação (MUI, custom, etc.)
    
    Retorna (url_pagina, numero_pagina) ou None.
    Se paginação é via <button> (sem href), retorna ("__BUTTON_PAGINATION__", max_page).
    Ex: ("https://site.com/imoveis?filtros&pagination=2", 2)
    """

    # ── PARTE A: <a href> com paginação ──────────────────────────────────────
    candidates: list[tuple[int, str, str, int]] = []  # (score, href, text, page_num)

    try:
        all_links = page.css("a[href]")
    except Exception:
        all_links = []

    for link in all_links:
        href = link.attrib.get("href", "")
        if not href or href in ("#", "javascript:void(0)", "javascript:;"):
            continue

        # Resolve relative
        if href.startswith("/"):
            href = f"https://{base_hostname}{href}"
        elif not href.startswith("http"):
            continue

        # Must be same domain
        try:
            if urlparse(href).hostname != base_hostname:
                continue
        except Exception:
            continue

        # Skip if it's the same page (listing URL)
        if href.rstrip("/") == listing_url.rstrip("/"):
            continue

        text = ""
        try:
            text = (link.text or "").strip()
        except Exception:
            pass

        aria_label = ""
        try:
            aria_label = (link.attrib.get("aria-label", "") or "").lower()
        except Exception:
            pass

        score = 0
        detected_page_num = 0

        if text.strip() == "2":
            score += 10
            detected_page_num = 2
        elif text.strip() == "3":
            score += 8
            detected_page_num = 3
        elif text.strip() in ("»", "›", ">", ">>"):
            score += 6
            detected_page_num = 2
        elif any(kw in text.lower() for kw in ["próxima", "próximo", "next", "seguinte"]):
            score += 6
            detected_page_num = 2
        elif any(kw in aria_label for kw in ["próxima", "next", "page 2", "página 2"]):
            score += 6
            detected_page_num = 2

        href_lower = href.lower()
        for param in ["pagination=", "pagina=", "page=", "pag=", "pg="]:
            if param in href_lower:
                m = re.search(rf"{re.escape(param)}(\d+)", href_lower)
                if m:
                    score += 5
                    if not detected_page_num:
                        detected_page_num = int(m.group(1))
                break

        # Check parent for pagination container
        try:
            parent = link.parent
            for _ in range(3):
                if parent is None:
                    break
                parent_classes = ""
                try:
                    parent_classes = (parent.attrib.get("class", "") or "").lower()
                except Exception:
                    pass
                parent_tag = ""
                try:
                    parent_tag = getattr(parent, "tag", "")
                except Exception:
                    pass
                if any(kw in parent_classes for kw in ["paginat", "pagina", "pager", "page-nav", "pages"]):
                    score += 4
                if parent_tag == "nav":
                    score += 2
                try:
                    parent = parent.parent
                except Exception:
                    break
        except Exception:
            pass

        if score > 0 and detected_page_num >= 2:
            candidates.append((score, href, text, detected_page_num))

    if candidates:
        candidates.sort(key=lambda x: (-x[0], x[3]))
        best = candidates[0]
        log.info(f"  Paginação DOM (link): {best[1]} (score={best[0]}, text='{best[2]}', pag={best[3]})")
        return (best[1], best[3])

    # ── PARTE B: <button> de paginação (MUI, React, etc.) ────────────────────
    # Muitos SPAs (Next.js, React) usam <button> ao invés de <a> para paginação.
    # Detectamos botões com texto numérico dentro de containers de paginação.
    try:
        button_page_nums: list[int] = []
        pagination_selectors = [
            "nav button",
            ".pagination button",
            "[class*=paginat] button",
            "[class*=Pagination] button",
            "[class*=page-nav] button",
            "[class*=pager] button",
            "button[class*=page]",
            "button[class*=Page]",
        ]
        for sel in pagination_selectors:
            try:
                buttons = page.css(sel)
                for btn in buttons:
                    text = ""
                    try:
                        text = (btn.text or "").strip()
                    except Exception:
                        continue
                    if text.isdigit():
                        num = int(text)
                        if 1 <= num <= 500:
                            button_page_nums.append(num)
            except Exception:
                continue

        if button_page_nums:
            max_page = max(button_page_nums)
            has_page_2 = 2 in button_page_nums
            if has_page_2 and max_page >= 2:
                log.info(f"  Paginação DOM (button): detectados botões de pág, max={max_page}")
                return ("__BUTTON_PAGINATION__", max_page)
    except Exception:
        pass

    # ── PARTE C: "Carregar mais" / "Load more" / "Ver mais" botões ───────
    # Esses indicam infinite scroll ou lazy loading — probar com query params
    try:
        for el in page.css("button, a[href], [role=button]"):
            text = ""
            try:
                text = (el.text or "").strip().lower()
            except Exception:
                continue
            if any(kw in text for kw in ["carregar mais", "ver mais", "mostrar mais",
                                          "load more", "show more", "mais imóveis",
                                          "mais imoveis"]):
                log.info(f"  Paginação DOM: botão '{text.strip()[:40]}' detectado → probing query params")
                return ("__BUTTON_PAGINATION__", 2)
    except Exception:
        pass

    return None


# ─── Discovery: encontrar URLs de imóveis ────────────────────────────────────

# Fallback — tentamos esses se o LLM não achar nada
LISTING_CANDIDATES_SUFFIXES = [
    # Venda
    "/imoveis/comprar",
    "/imoveis/venda",
    "/comprar",
    "/venda",
    "/imoveis?finalidade=venda",
    "/imoveis?tipo=venda",
    # Aluguel
    "/imoveis/alugar",
    "/imoveis/aluguel",
    "/alugar",
    "/aluguel",
    "/imoveis?finalidade=aluguel",
    "/imoveis?tipo=aluguel",
    # Genérico
    "/imoveis",
]

# Regex para achar link da página 2 no HTML
PAGINATION_PATTERNS_PAGE2 = [
    r'href=["\']([^"\']*(?:pagina|page|pag|pg|pagination)[=/]2[^"\']*)["\']',
    r'href=["\']([^"\']*[?&](?:pagina|page|pag|pg|pagination)=2[^"\']*)["\']',
]


def _llm_analyze_site(html: str, site_url: str, on_progress: Optional[Callable] = None) -> Optional[dict]:
    """
    Usa LLM para analisar a homepage e retornar insights estruturados sobre o site:
    - URLs de listagem de venda e aluguel
    - Padrão de paginação
    - Observações sobre a estrutura
    
    Retorna dict com:
    {
      "listagens": [
        {"url": "...", "tipo": "venda|aluguel|ambos", "descricao": "..."},
        ...
      ],
      "paginacao": {
        "tipo": "query_param|path_segment|nenhuma",
        "parametro": "page",
        "exemplo_pagina2": "https://site.com/imoveis/comprar?page=2"
      },
      "observacoes": "..."
    }
    """
    import json as json_mod
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
        if text or any(kw in href.lower() for kw in ["imov", "comprar", "venda", "alug", "locacao", "page", "pagina"]):
            links_info.append(f"- {href}  ({text})")

    if not links_info:
        return None

    # Limitar para não exceder tokens
    links_text = "\n".join(links_info[:120])

    prompt = f"""Analise os links desta homepage de um site imobiliário brasileiro.
Quero entender a ESTRUTURA do site para fazer crawling automático.

Site: {site_url}

Links encontrados na homepage:
{links_text}

Retorne um JSON com esta estrutura EXATA (sem markdown, sem explicação, SOMENTE o JSON):
{{
  "listagens": [
    {{
      "url": "URL completa da página de listagem",
      "tipo": "venda ou aluguel ou ambos",
      "descricao": "breve descrição do que é esta listagem"
    }}
  ],
  "paginacao": {{
    "tipo": "query_param ou path_segment ou nenhuma",
    "parametro": "nome do parâmetro (ex: page, pagina, pag) ou null",
    "exemplo_pagina2": "URL completa da página 2 da primeira listagem, ou null"
  }},
  "observacoes": "qualquer insight útil sobre a estrutura do site"
}}

REGRAS:
- Identifique TODAS as listagens: venda E aluguel, se existirem.
- Use URLs que mostram o CATÁLOGO/LISTAGEM de imóveis (não um imóvel específico).
- Prefira URLs genéricas (sem filtro de cidade/bairro específico).
- EVITE páginas de 'destaques', 'destaque', 'highlights', 'featured' ou 'em-destaque'
  (ex: /imoveis/locacoes/destaques). Elas mostram apenas seleções curadas, não o catálogo completo.
- Se o site tiver SUBCATEGORIAS de listagem (ex: /imoveis/locacoes/residenciais,
  /imoveis/locacoes/comerciais, /imoveis/locacoes/industriais, /imoveis/vendas/residenciais),
  inclua CADA subcategoria como uma listagem separada no array 'listagens'.
  É melhor retornar muitas listagens do que perder imóveis!
- Para sites com botão 'Carregar mais' ou infinite scroll (sem página 2 na URL),
  defina paginacao.tipo como 'nenhuma' (o crawler vai clicar o botão automaticamente).
- Para paginação: analise os links e tente deduzir o padrão.
  Ex: se existe /imoveis/comprar, a pág 2 provavelmente é /imoveis/comprar?page=2
- Se não houver listagens visíveis, retorne listagens como array vazio.
- Retorne SOMENTE o JSON válido, nada mais.
"""

    try:
        from app.extractor import _llm_chat
        answer = _llm_chat(
            messages=[
                {"role": "system", "content": "Você é um especialista em análise de sites imobiliários brasileiros. Retorne SOMENTE JSON válido, sem markdown."},
                {"role": "user", "content": prompt},
            ],
        )

        if not answer:
            progress("  LLM não retornou resposta")
            return None

        # Limpar resposta: remover markdown code blocks se existirem
        answer = answer.strip()
        if answer.startswith("```"):
            answer = re.sub(r"^```(?:json)?\s*", "", answer)
            answer = re.sub(r"\s*```$", "", answer)
        answer = answer.strip()

        result = json_mod.loads(answer)

        # Log dos insights
        listagens = result.get("listagens", [])
        paginacao = result.get("paginacao", {})
        obs = result.get("observacoes", "")

        progress(f"  🤖 LLM analisou o site:")
        for lst in listagens:
            progress(f"    📋 {lst.get('tipo', '?').upper()}: {lst.get('url', '?')}")
            if lst.get("descricao"):
                progress(f"       {lst['descricao']}")

        pag_tipo = paginacao.get("tipo", "nenhuma")
        pag_param = paginacao.get("parametro", "-")
        pag_ex = paginacao.get("exemplo_pagina2", "-")
        progress(f"    📄 Paginação: {pag_tipo} (param={pag_param})")
        if pag_ex and pag_ex != "null":
            progress(f"       Ex pág 2: {pag_ex}")
        if obs:
            progress(f"    💡 {obs}")

        return result

    except json_mod.JSONDecodeError as e:
        log.warning(f"LLM retornou JSON inválido: {e}")
        # Tentar extrair URLs mesmo do texto mal-formatado
        return None
    except Exception as e:
        log.warning(f"LLM site analysis falhou: {e}")
        return None


def discover_property_urls(
    site_url: str,
    on_progress: Optional[Callable[[str], None]] = None,
) -> list[str]:
    """
    Descobre todas as URLs de imóveis de um site imobiliário (venda + aluguel).
    
    1. Usa LLM para analisar a homepage → retorna insights estruturados
       (listagens encontradas, padrão de paginação, observações)
    2. Fallback: testa URLs comuns (hardcoded)
    3. Usa paginação do LLM OU detecta automaticamente
    4. Navega todas as páginas coletando links de detalhe
    """
    progress = on_progress or log.info
    base_url = site_url.rstrip("/")
    base_hostname = urlparse(site_url).hostname or ""
    all_detail_urls: set[str] = set()

    # ── 1. Analisar o site com LLM ──────────────────────────────────────────
    progress(f"{'─'*50}")
    progress(f"FASE 1: Analisando estrutura do site (LLM)")
    progress(f"Site: {base_url}")
    progress(f"{'─'*50}")

    listing_urls: list[str] = []  # URLs de listagem confirmadas (URL final pós-redirect)
    listing_cache: dict[str, tuple] = {}  # {url_final: (page, links)} — cache da Fase 1
    listing_tipos: dict[str, str] = {}  # {url_final: tipo} — para dedup por tipo
    llm_pagination_hint: Optional[dict] = None  # Dica de paginação do LLM

    # SEMPRE usa Playwright — renderiza JS, SPAs, botões, tudo.
    used_stealth = True

    # Conjunto de URLs finais já vistas (para dedup de redirects)
    seen_final_urls: set[str] = set()

    # 1a. Fetch homepage e pedir LLM para analisar
    progress(f"  Buscando homepage (Playwright): {base_url}")
    homepage = fetch_page(base_url, stealth=True)

    if homepage:
        homepage_html = safe_html(homepage)

        # Pedir análise completa ao LLM
        progress(f"  🤖 Pedindo análise do site ao LLM...")
        site_analysis = _llm_analyze_site(homepage_html, site_url, on_progress=progress)

        if site_analysis:
            # Extrair paginação hint
            llm_pagination_hint = site_analysis.get("paginacao")

            # Testar cada listagem que o LLM identificou
            for lst in site_analysis.get("listagens", []):
                llm_url = lst.get("url", "").strip()
                lst_tipo = lst.get("tipo", "?")
                if not llm_url or not llm_url.startswith("http"):
                    continue

                # Pré-check: se a URL crua já é uma URL final conhecida, pular sem fetch
                if llm_url in seen_final_urls:
                    progress(f"  Pulando listagem ({lst_tipo}): {llm_url} (já vista)")
                    continue

                progress(f"  Testando listagem ({lst_tipo}): {llm_url}")
                llm_page = fetch_page(llm_url, stealth=True)
                if llm_page:
                    # URL final pós-redirect (ex: /alugar/ → /alugar/cidade/caxias-do-sul/1/)
                    final_url = getattr(llm_page, 'url', llm_url) or llm_url
                    if final_url in seen_final_urls:
                        progress(f"  ↳ Duplicada (redireciona para URL já vista), pulando")
                        continue
                    seen_final_urls.add(final_url)
                    seen_final_urls.add(llm_url)  # Guardar URL original também

                    links = extract_detail_links(llm_page, base_hostname)
                    progress(f"  ↳ {len(links)} imóveis encontrados")
                    if len(links) >= 1:
                        listing_urls.append(final_url)
                        listing_tipos[final_url] = lst_tipo
                        # Cache: salvar page + links para reutilizar na Fase 2
                        listing_cache[final_url] = (llm_page, links)
                    else:
                        progress(f"  ↳ 0 imóveis, descartando")
                else:
                    progress(f"  ↳ Sem resposta")

    # 1b. Fallback: tentar URLs hardcoded se LLM não achou nada
    if not listing_urls:
        progress(f"  Fallback: testando URLs comuns...")
        for suffix in LISTING_CANDIDATES_SUFFIXES:
            candidate = f"{base_url}{suffix}"
            progress(f"    Tentando: {candidate}")

            page = fetch_page(candidate, stealth=True)
            if not page:
                continue

            final_url = getattr(page, 'url', candidate) or candidate
            if final_url in seen_final_urls:
                continue
            seen_final_urls.add(final_url)

            links = extract_detail_links(page, base_hostname)
            progress(f"    ↳ {len(links)} imóveis")

            if len(links) >= 1:
                listing_urls.append(final_url)
                listing_cache[final_url] = (page, links)

    # Deduplicate listing URLs (já são URLs finais, mas por segurança)
    listing_urls = list(dict.fromkeys(listing_urls))

    # ── Dedup por tipo: manter até 3 URLs por tipo ──
    # (evita 10+ subcategorias do mesmo tipo, ex: venda/terreno, venda/casa, etc.
    #  mas mantém subcategorias legítimas como residenciais/comerciais/industriais)
    MAX_PER_TIPO = 3
    if len(listing_urls) > MAX_PER_TIPO * 2:
        from collections import defaultdict
        tipo_groups: dict[str, list[tuple[str, int]]] = defaultdict(list)
        for url in listing_urls:
            raw_tipo = listing_tipos.get(url, "?").lower()
            if "venda" in raw_tipo or "compra" in raw_tipo:
                norm_tipo = "venda"
            elif "alug" in raw_tipo or "loca" in raw_tipo:
                norm_tipo = "alugar"
            else:
                norm_tipo = raw_tipo
            link_count = len(listing_cache.get(url, (None, []))[1])
            tipo_groups[norm_tipo].append((url, link_count))

        filtered: list[str] = []
        for tipo, group in tipo_groups.items():
            group.sort(key=lambda x: x[1], reverse=True)
            keep = group[:MAX_PER_TIPO]
            for url, count in keep:
                filtered.append(url)
            if len(group) > MAX_PER_TIPO:
                progress(f"  Tipo '{tipo}': mantendo top {MAX_PER_TIPO} de {len(group)} subcategorias")

        if len(filtered) < len(listing_urls):
            progress(f"  Dedup por tipo: {len(listing_urls)} → {len(filtered)} listagens")
            listing_urls = filtered

    if not listing_urls:
        progress("✗ Nenhuma listagem encontrada")
        return []

    progress(f"✓ {len(listing_urls)} listagem(s) confirmada(s):")
    for u in listing_urls:
        progress(f"  • {u}")

    # ── 2. Paginação de cada listagem ────────────────────────────────────────
    progress(f"\n{'─'*50}")
    progress(f"FASE 2: Paginação")
    progress(f"{'─'*50}")

    # Template de paginação confirmado na listagem anterior (reutilizar)
    confirmed_template: Optional[str] = None

    for listing_idx, listing_url in enumerate(listing_urls, 1):
        progress(f"\n  📂 Listagem {listing_idx}/{len(listing_urls)}: {listing_url}")

        # Usar cache da Fase 1 se disponível (evita re-fetch da pág 1)
        if listing_url in listing_cache:
            page, page1_links = listing_cache[listing_url]
            progress(f"    (usando cache da Fase 1)")
        else:
            page = fetch_page(listing_url, stealth=used_stealth)
            if not page:
                progress(f"    ✗ Sem resposta")
                continue
            page1_links = extract_detail_links(page, base_hostname)

        before_count = len(all_detail_urls)
        for link in page1_links:
            all_detail_urls.add(link)
        new_p1 = len(all_detail_urls) - before_count
        progress(f"    Pág 1: +{new_p1} novos (total: {len(all_detail_urls)})")

        # Se página 1 não trouxe nenhum URL novo, pular paginação inteira
        # (mesmos imóveis de outra listagem já processada)
        if new_p1 == 0 and listing_idx > 1:
            progress(f"    ↳ Sem novos — pulando paginação desta listagem")
            continue

        # Detectar paginação: primeiro tenta com hint do LLM, depois detecção auto
        page2_url = None
        used_llm_hint = False  # Flag: paginação veio do LLM hint?
        p1_page = page  # Guardar page 1 DOM para fallback

        # 2a. LLM hint: adaptar a URL de paginação para esta listagem
        if llm_pagination_hint:
            hint_page2 = llm_pagination_hint.get("exemplo_pagina2")
            hint_tipo = llm_pagination_hint.get("tipo", "nenhuma")
            hint_param = llm_pagination_hint.get("parametro")

            # Adaptar o hint para a listagem atual (ex: /alugar/.../2/ → /comprar/.../2/)
            if hint_page2 and hint_page2 != "null" and hint_page2.startswith("http"):
                # Para listagem 1, usar hint direto. Para as demais, construir a URL equivalente.
                if listing_idx > 1 and hint_tipo == "path_segment":
                    # Tentar construir pág 2 substituindo o último segmento numérico
                    # Ex: listing_url = /comprar/cidade/caxias-do-sul/1/ → /comprar/cidade/caxias-do-sul/2/
                    adapted_url = re.sub(r'/1/?$', '/2/', listing_url.rstrip('/') + '/')
                    if adapted_url != listing_url.rstrip('/') + '/':
                        hint_page2 = adapted_url
                    else:
                        # Append /2/ ao final
                        hint_page2 = listing_url.rstrip('/') + '/2/'
                elif listing_idx > 1 and hint_tipo == "query_param":
                    # Extrair query params do hint e aplicar à URL da listagem atual
                    hint_parsed = urlparse(hint_page2)
                    if hint_parsed.query:
                        sep = "&" if "?" in listing_url else "?"
                        hint_page2 = f"{listing_url}{sep}{hint_parsed.query}"

                progress(f"    🤖 Testando paginação do LLM: {hint_page2}")
                p2 = fetch_page(hint_page2, stealth=used_stealth)
                if p2:
                    p2_links = extract_detail_links(p2, base_hostname)
                    if p2_links:
                        # Validar: se pág 2 tem links mas NENHUM novo, não é paginação real
                        # (site pode ignorar o param e retornar a mesma página)
                        p2_new = [l for l in p2_links if l not in all_detail_urls]
                        if p2_new:
                            progress(f"    ✓ Paginação LLM funcionou: {len(p2_links)} imóveis na pág 2")
                            page2_url = hint_page2
                            used_llm_hint = True
                            for l in p2_links:
                                all_detail_urls.add(l)
                            progress(f"    Pág 2: +{len(p2_new)} novos (total: {len(all_detail_urls)})")
                        else:
                            progress(f"    ✗ Paginação LLM retornou mesmos imóveis de pág 1 — ignorando")
                    else:
                        progress(f"    ✗ Paginação LLM sem imóveis")
                else:
                    progress(f"    ✗ Paginação LLM sem resposta")

            # Se o LLM deu o parâmetro mas não a URL exata, construir
            if not page2_url and hint_param and hint_tipo == "query_param":
                constructed = f"{listing_url}?{hint_param}=2"
                # Se listing_url já tem query params, usar &
                if "?" in listing_url:
                    constructed = f"{listing_url}&{hint_param}=2"
                progress(f"    🤖 Construindo paginação com param do LLM: {constructed}")
                p2 = fetch_page(constructed, stealth=used_stealth)
                if p2:
                    p2_links = extract_detail_links(p2, base_hostname)
                    if p2_links:
                        p2_new = [l for l in p2_links if l not in all_detail_urls]
                        if p2_new:
                            progress(f"    ✓ Paginação construída funcionou: {len(p2_links)} imóveis")
                            page2_url = constructed
                            used_llm_hint = True
                            for l in p2_links:
                                all_detail_urls.add(l)
                            progress(f"    Pág 2: +{len(p2_new)} novos (total: {len(all_detail_urls)})")
                        else:
                            progress(f"    ✗ Paginação construída retornou mesmos imóveis — ignorando")
        
        # 2b. Detecção automática (fallback se LLM hint não funcionou)
        if not page2_url:
            page2_url = _detect_page2_url(
                page, listing_url, base_hostname,
                use_stealth=True,
                llm_pagination_hint=llm_pagination_hint,
                page1_links=set(page1_links),
            )

        if not page2_url:
            progress(f"    Sem paginação por URL detectada")

            # ── Fallback: infinite scroll / "Carregar mais" ──────────────
            # Se a paginação por URL falhou, tenta carregar mais via scroll/click.
            # Detectar se a página tem botão "Carregar mais" ou similar
            has_load_more = False
            try:
                for el in page.css("button, a[href], [role=button]"):
                    text = ""
                    try:
                        text = (el.text or "").strip().lower()
                    except Exception:
                        continue
                    if any(kw in text for kw in ["carregar mais", "ver mais", "mostrar mais",
                                                  "load more", "show more", "mais imóveis",
                                                  "mais imoveis"]):
                        has_load_more = True
                        break
            except Exception:
                pass

            if has_load_more:
                progress(f"    📜 Detectado infinite scroll — carregando via scroll/click...")
                scroll_page = fetch_page_with_scroll(listing_url, max_scrolls=50, on_progress=progress)
                if scroll_page:
                    scroll_links = extract_detail_links(scroll_page, base_hostname)
                    new_scroll = [l for l in scroll_links if l not in all_detail_urls]
                    for l in scroll_links:
                        all_detail_urls.add(l)
                    progress(f"    📜 Scroll: +{len(new_scroll)} novos (total: {len(all_detail_urls)})")
                else:
                    progress(f"    ✗ Scroll falhou")
            else:
                # ── Fallback 2: JS pagination (href="#" com números de página) ──
                # Detectar botões de paginação JavaScript
                has_js_pagination = False
                try:
                    for container in page.css("#pagination, .pagination, [class*=paginat]"):
                        page_links = container.css("a")
                        # Verificar se há links com href="#" e texto numérico
                        numeric_buttons = 0
                        for a in page_links:
                            try:
                                href = (a.attrib.get("href", "") or "").strip()
                                text = (a.text or "").strip()
                                # Texto pode estar em <span> filho
                                if not text:
                                    spans = a.css("span")
                                    if spans:
                                        text = (spans[0].text or "").strip()
                                if (href == "#" or href == "") and text.isdigit():
                                    numeric_buttons += 1
                            except Exception:
                                continue
                        if numeric_buttons >= 2:  # Pelo menos 2 botões numéricos
                            has_js_pagination = True
                            break
                except Exception:
                    pass

                if has_js_pagination:
                    progress(f"    📄 Detectado JS pagination (href='#') — clicando páginas...")
                    js_links = fetch_page_with_js_pagination(
                        listing_url, base_hostname, max_pages=50, on_progress=progress
                    )
                    new_js = [l for l in js_links if l not in all_detail_urls]
                    for l in js_links:
                        all_detail_urls.add(l)
                    progress(f"    📄 JS paginação: +{len(new_js)} novos (total: {len(all_detail_urls)})")
                else:
                    progress(f"    Sem paginação detectada")
            continue

        # Detectar o número da página que a URL representa
        # (normalmente 2, mas _find_pagination_in_dom pode achar 3)
        _detected_pn = 2  # default
        for _pn_param in ["pagination", "pagina", "page", "pag", "pg", "p"]:
            _pn_match = re.search(rf"[?&]{_pn_param}=(\d+)", page2_url, re.I)
            if _pn_match:
                _detected_pn = int(_pn_match.group(1))
                break

        # Converter URL da pág N em template
        template = _url_to_template(page2_url, page_num=_detected_pn)
        if template:
            progress(f"    Template: {template}")
        else:
            progress(f"    Paginação detectada mas sem template")
            continue

        # Navegar todas as páginas
        # Se pág 2 já foi processada pelo LLM hint (links já adicionados), começar da 3
        # Se pág 2 veio de _detect_page2_url, NÃO pular (links não foram adicionados)
        # Usa Playwright até confirmar que o template funciona (2 págs com resultados),
        # depois muda para HTTP puro (~1s vs ~5-30s por página).
        empty_pages = 0
        page_num = _detected_pn + 1 if (page2_url and used_llm_hint) else _detected_pn  # Pular pág 2 só se LLM hint já processou
        template_confirmed = confirmed_template is not None and listing_idx > 1
        consecutive_ok = 1 if (page2_url and used_llm_hint) else 0  # Pág 2 do hint já conta
        useful_pages = 2 if (page2_url and used_llm_hint) else 1  # Contador de págs com resultados
        stealth_required = False  # SPA detectado: HTTP não retorna links

        while page_num <= MAX_PAGES and empty_pages < 2:
            page_url = template.replace("{N}", str(page_num))

            # Depois de confirmar template, usar HTTP puro (10x mais rápido)
            # Exceto se SPA detectado (HTTP retorna 0 links)
            use_stealth = True if (not template_confirmed or stealth_required) else False
            page = fetch_page(page_url, stealth=use_stealth)

            # Se HTTP falhou mas template confirmado, tentar Playwright como fallback
            if not page and template_confirmed:
                page = fetch_page(page_url, stealth=True)

            if not page:
                progress(f"    Pág {page_num}: ✗ sem resposta, parando")
                break

            links = extract_detail_links(page, base_hostname)

            # SPA detection: HTTP retornou página mas 0 links → tentar Playwright
            if not links and template_confirmed and not use_stealth and not stealth_required:
                page = fetch_page(page_url, stealth=True)
                if page:
                    links = extract_detail_links(page, base_hostname)
                    if links:
                        stealth_required = True
                        progress(f"    (SPA detectado: HTTP vazio, usando Playwright)")

            new_links = [l for l in links if l not in all_detail_urls]

            if not new_links:
                empty_pages += 1
                progress(f"    Pág {page_num}: 0 novos ({empty_pages}/2 vazias)")
                consecutive_ok = 0
            else:
                empty_pages = 0
                consecutive_ok += 1
                useful_pages += 1
                for l in links:
                    all_detail_urls.add(l)
                progress(f"    Pág {page_num}: +{len(new_links)} novos (total: {len(all_detail_urls)})")

                # Confirmar template depois de 2 págs consecutivas com resultados
                if not template_confirmed and consecutive_ok >= 2:
                    template_confirmed = True
                    progress(f"    ✓ Template confirmado — acelerando com HTTP")

            page_num += 1

        # ── FALLBACK: se paginação LLM foi fraca, tentar auto-detecção ──────
        # Se o LLM sugeriu ?page=N mas o correto era ?pagination=N (ou outro),
        # a paginação morre rápido. Nesse caso, tentar auto-detect via DOM/probing.
        if used_llm_hint and useful_pages <= 3 and p1_page:
            progress(f"    ⚠️ Paginação LLM fraca ({useful_pages} págs úteis), tentando auto-detecção...")
            fallback_p2 = _detect_page2_url(
                p1_page, listing_url, base_hostname,
                use_stealth=True,
                llm_pagination_hint=None,  # Ignorar hint para forçar probing
                page1_links=set(page1_links),
            )
            if fallback_p2:
                fallback_template = _url_to_template(fallback_p2, page_num=2)
                if fallback_template and fallback_template != template:
                    progress(f"    ⚡ Auto-detecção achou template diferente: {fallback_template}")
                    # Processar pág 2 do fallback
                    fb_page = fetch_page(fallback_p2, stealth=True)
                    if fb_page:
                        fb_links = extract_detail_links(fb_page, base_hostname)
                        fb_new = [l for l in fb_links if l not in all_detail_urls]
                        for l in fb_links:
                            all_detail_urls.add(l)
                        if fb_new:
                            progress(f"    Pág 2 (fallback): +{len(fb_new)} novos (total: {len(all_detail_urls)})")

                        # Re-paginar com template correto
                        template = fallback_template
                        page_num = 3
                        empty_pages = 0
                        template_confirmed = False
                        consecutive_ok = 1 if fb_new else 0

                        while page_num <= MAX_PAGES and empty_pages < 2:
                            page_url = template.replace("{N}", str(page_num))
                            use_stealth_fb = True if (not template_confirmed or stealth_required) else False
                            pg = fetch_page(page_url, stealth=use_stealth_fb)
                            if not pg and template_confirmed:
                                pg = fetch_page(page_url, stealth=True)
                            if not pg:
                                progress(f"    Pág {page_num}: ✗ sem resposta, parando")
                                break
                            fb_lnks = extract_detail_links(pg, base_hostname)
                            # SPA detection no fallback
                            if not fb_lnks and template_confirmed and not use_stealth_fb and not stealth_required:
                                pg = fetch_page(page_url, stealth=True)
                                if pg:
                                    fb_lnks = extract_detail_links(pg, base_hostname)
                                    if fb_lnks:
                                        stealth_required = True
                                        progress(f"    (SPA detectado no fallback: usando Playwright)")
                            fb_new_lnks = [l for l in fb_lnks if l not in all_detail_urls]
                            if not fb_new_lnks:
                                empty_pages += 1
                                progress(f"    Pág {page_num}: 0 novos ({empty_pages}/2 vazias)")
                                consecutive_ok = 0
                            else:
                                empty_pages = 0
                                consecutive_ok += 1
                                for l in fb_lnks:
                                    all_detail_urls.add(l)
                                progress(f"    Pág {page_num}: +{len(fb_new_lnks)} novos (total: {len(all_detail_urls)})")
                                if not template_confirmed and consecutive_ok >= 2:
                                    template_confirmed = True
                                    progress(f"    ✓ Template fallback confirmado — acelerando com HTTP")
                            page_num += 1
                else:
                    progress(f"    Auto-detecção: mesmo template ou sem resultado")
                    # Último recurso: scroll / "Carregar mais"
                    _has_load_more_tm = False
                    try:
                        for el in p1_page.css("button, a[href], [role=button]"):
                            text = (el.text or "").strip().lower()
                            if any(kw in text for kw in ["carregar mais", "ver mais", "mostrar mais", "load more"]):
                                _has_load_more_tm = True
                                break
                    except Exception:
                        pass
                    if _has_load_more_tm:
                        progress(f"    📜 Fallback scroll: 'Carregar mais' encontrado — carregando...")
                        scroll_page = fetch_page_with_scroll(listing_url, max_scrolls=50, on_progress=progress)
                        if scroll_page:
                            scroll_links = extract_detail_links(scroll_page, base_hostname)
                            new_scroll = [l for l in scroll_links if l not in all_detail_urls]
                            for l in scroll_links:
                                all_detail_urls.add(l)
                            progress(f"    📜 Scroll: +{len(new_scroll)} novos (total: {len(all_detail_urls)})")
            else:
                # Tentar JS pagination (href="#") como último recurso
                _js_pag_found = False
                if p1_page:
                    try:
                        for sel in ["#pagination", ".pagination", ".paginacao", "[class*=pagina]", "nav[aria-label*=pag]", "ul.pages"]:
                            container = p1_page.css(sel)
                            if not container:
                                continue
                            numeric_buttons = 0
                            for a in container[0].css("a"):
                                try:
                                    href = (a.attrib.get("href", "") or "").strip()
                                    text = (a.text or "").strip()
                                    # Texto pode estar em <span> filho
                                    if not text:
                                        spans = a.css("span")
                                        if spans:
                                            text = (spans[0].text or "").strip()
                                    if (href == "#" or href == "") and text.isdigit():
                                        numeric_buttons += 1
                                except Exception:
                                    continue
                            if numeric_buttons >= 2:
                                _js_pag_found = True
                                break
                    except Exception:
                        pass

                if _js_pag_found:
                    progress(f"    📄 Detectado JS pagination (fallback) — clicando páginas...")
                    js_links = fetch_page_with_js_pagination(
                        listing_url, base_hostname, max_pages=50, on_progress=progress
                    )
                    new_js = [l for l in js_links if l not in all_detail_urls]
                    for l in js_links:
                        all_detail_urls.add(l)
                    progress(f"    📄 JS paginação: +{len(new_js)} novos (total: {len(all_detail_urls)})")
                else:
                    progress(f"    Auto-detecção: sem paginação encontrada")

        # Salvar template confirmado para reutilizar nas listagens seguintes
        if template_confirmed and confirmed_template is None:
            confirmed_template = template
            progress(f"    (template salvo para próximas listagens)")

        # Para as listagens subsequentes, aplicar hint de paginação baseado no param
        if llm_pagination_hint and page2_url:
            _detected_param = None
            for param in ["page", "pagina", "pag", "pg", "pagination"]:
                if f"{param}=" in page2_url and re.search(rf"{param}=\d+", page2_url):
                    _detected_param = param
                    break
            if _detected_param and not llm_pagination_hint.get("parametro"):
                llm_pagination_hint["parametro"] = _detected_param
                llm_pagination_hint["tipo"] = "query_param"

    progress(f"\n✓ Descoberta concluída: {len(all_detail_urls)} URLs")
    return list(all_detail_urls)


def _detect_page2_url(
    page, listing_url: str, base_hostname: str,
    use_stealth: bool = False,
    llm_pagination_hint: Optional[dict] = None,
    page1_links: Optional[set] = None,
) -> Optional[str]:
    """
    Detecta o URL da página 2 da paginação.
    
    Suporta:
    - <a href> com query param de paginação
    - <button> de paginação (MUI, React) → probe com parâmetros comuns
    - Regex no HTML
    - Probes com padrões comuns
    
    page1_links: conjunto de URLs da página 1 para validar que página 2 é DIFERENTE.
    """
    _p1 = page1_links or set()
    if not page:
        return None

    # 0. Procurar links/botões de paginação no DOM renderizado
    dom_result = _find_pagination_in_dom(page, listing_url, base_hostname)
    if dom_result:
        dom_url, dom_page_num = dom_result

        # Se é paginação via <a href> (URL real), usar diretamente
        if dom_url != "__BUTTON_PAGINATION__":
            log.info(f"  Paginação via DOM (link): {dom_url} (pág {dom_page_num})")
            return dom_url

        # Paginação via <button> (sem href) — precisamos descobrir o parâmetro
        log.info(f"  Paginação via DOM (button): {dom_page_num} páginas detectadas, probing parâmetros...")

        # Primeiro: usar hint do LLM se disponível
        if llm_pagination_hint:
            hint_param = llm_pagination_hint.get("parametro")
            hint_page2 = llm_pagination_hint.get("exemplo_pagina2")
            if hint_page2 and hint_page2.startswith("http"):
                log.info(f"    Probe LLM hint: {hint_page2}")
                p2 = fetch_page(hint_page2, stealth=use_stealth)
                if p2:
                    links = extract_detail_links(p2, base_hostname)
                    if links:
                        log.info(f"    ✓ LLM hint funcionou: {len(links)} imóveis")
                        return hint_page2
            if hint_param:
                sep = "&" if "?" in listing_url else "?"
                probe = f"{listing_url}{sep}{hint_param}=2"
                log.info(f"    Probe LLM param ({hint_param}): {probe}")
                p2 = fetch_page(probe, stealth=use_stealth)
                if p2:
                    links = extract_detail_links(p2, base_hostname)
                    if links:
                        # Validar que pág 2 tem itens DIFERENTES da pág 1
                        p2_new = [l for l in links if l not in _p1]
                        if p2_new:
                            log.info(f"    ✓ LLM param funcionou: {len(links)} imóveis (+{len(p2_new)} novos)")
                            return probe
                        else:
                            log.info(f"    ✗ LLM param: {len(links)} imóveis mas todos iguais à pág 1")

        # Segundo: probe com nomes de parâmetro comuns
        for param in ["pagination", "page", "pagina", "pag", "pg"]:
            sep = "&" if "?" in listing_url else "?"
            probe = f"{listing_url}{sep}{param}=2"
            log.info(f"    Probe button ({param}): {probe}")
            p2 = fetch_page(probe, stealth=use_stealth)
            if p2:
                links = extract_detail_links(p2, base_hostname)
                if links:
                    # Validar: pág 2 DEVE ter itens diferentes da pág 1
                    # (sites com 'Carregar mais' geralmente ignoram ?param=N via URL)
                    p2_new = [l for l in links if l not in _p1]
                    if p2_new:
                        log.info(f"    ✓ Probe {param} funcionou: {len(links)} imóveis na pág 2 (+{len(p2_new)} novos)")
                        return probe
                    else:
                        log.info(f"    ✗ Probe {param}: {len(links)} imóveis mas todos iguais à pág 1 — site ignora parâmetro")
                else:
                    log.debug(f"    ✗ {param}=2 sem imóveis")

        log.info(f"    ✗ Nenhum parâmetro de paginação funcionou para botões")

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
        'a[href*="pagination=2"]',
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

    # 3. Probe: tentar padrões comuns de query string (ANTES de path-based)
    # Query params são mais confiáveis que path append, que pode confundir
    # filtros de tipo (/imoveis/2/ = tipo, não página) com paginação.
    for param in ["page", "pagina", "pagination", "pag", "pg"]:
        sep = "&" if "?" in listing_url else "?"
        probe_url = f"{listing_url}{sep}{param}=2"
        log.debug(f"  Probe query ({param}): {probe_url}")
        p2 = fetch_page(probe_url, stealth=use_stealth)
        if p2:
            links = extract_detail_links(p2, base_hostname)
            if links:
                # Validar: links da pág 2 devem ser DIFERENTES da pág 1
                # Sites que ignoram ?page=N retornam os mesmos imóveis
                p2_new = [l for l in links if l not in _p1]
                if p2_new:
                    # Validação extra: verificar página 3 também tem links novos
                    # Sites que ignoram ?page=N retornam sempre a mesma coisa
                    all_so_far = _p1 | set(links)
                    probe3_url = f"{listing_url}{sep}{param}=3"
                    p3 = fetch_page(probe3_url, stealth=use_stealth)
                    if p3:
                        p3_links = extract_detail_links(p3, base_hostname)
                        p3_new = [l for l in p3_links if l not in all_so_far]
                        if p3_new:
                            log.info(f"  ✓ Paginação query probe funcionou ({param}): pág2={len(links)}, pág3={len(p3_links)}, novos_p3={len(p3_new)} — {probe_url}")
                            return probe_url
                        else:
                            log.info(f"  ✗ Probe ({param}): pág 2 OK ({len(p2_new)} novos) mas pág 3 repetida — site ignora paginação")
                    else:
                        # Página 3 falhou — aceitar página 2 com cautela
                        log.info(f"  ✓ Paginação query probe ({param}): {len(links)} imóveis (+{len(p2_new)} novos, pág 3 sem resposta) — {probe_url}")
                        return probe_url
                else:
                    log.info(f"  ✗ Probe ({param}) retornou mesmos {len(links)} imóveis da pág 1 — ignorando")

    # 4. Path-based pagination (último segmento já é número)
    parsed = urlparse(listing_url)
    path = parsed.path.rstrip("/")
    segments = path.split("/")
    
    if segments and re.match(r"^\d+$", segments[-1]):
        segments[-1] = "2"
        page2_path = "/".join(segments) + "/"
        page2_url = f"https://{base_hostname}{page2_path}"
        log.info(f"  Tentando paginação path-based: {page2_url}")
        page2 = fetch_page(page2_url, stealth=use_stealth)
        if page2:
            links = extract_detail_links(page2, base_hostname)
            if links:
                p2_new = [l for l in links if l not in _p1]
                if p2_new:
                    log.info(f"  ✓ Paginação path-based funcionou: {len(links)} imóveis (+{len(p2_new)} novos)")
                    return page2_url
                else:
                    log.info(f"  ✗ Path-based retornou mesmos imóveis da pág 1 — ignorando")

    # 5. Tentar ADICIONAR /2/ no final (com validação de redirect)
    # APENAS para URLs sem query string — URLs com ?params geram caminhos inválidos
    # como /imoveis?ordenacao=id/2/ que é um falso positivo (retorna pág 1 ou categoria)
    if "?" not in listing_url:
        probe_url = f"{listing_url.rstrip('/')}/2/"
        log.debug(f"  Probe append /2/: {probe_url}")
        page2 = fetch_page(probe_url, stealth=use_stealth)
        if page2:
            # Verificar se houve redirect: se o URL final é muito diferente,
            # provavelmente /2/ é um filtro (tipo=2), não paginação
            final_url = getattr(page2, 'url', probe_url) or probe_url
            probe_path = urlparse(probe_url).path.rstrip("/")
            final_path = urlparse(final_url).path.rstrip("/")
            if final_path != probe_path:
                log.info(f"  ✗ Probe /2/ redirecionou ({final_url}), ignorando (provável filtro, não paginação)")
            else:
                links = extract_detail_links(page2, base_hostname)
                if links:
                    p2_new = [l for l in links if l not in _p1]
                    if p2_new:
                        # Validação com página 3: /imoveis/2/ pode ser categoria, não paginação
                        # Se /3/ também tiver novos itens, aí é paginação real
                        all_so_far = _p1 | set(links)
                        probe3_url = f"{listing_url.rstrip('/')}/3/"
                        p3 = fetch_page(probe3_url, stealth=use_stealth)
                        if p3:
                            p3_links = extract_detail_links(p3, base_hostname)
                            p3_new = [l for l in p3_links if l not in all_so_far]
                            if p3_new:
                                log.info(f"  ✓ Paginação path-append funcionou: pág2={len(links)}, pág3={len(p3_links)}, novos_p3={len(p3_new)} — {probe_url}")
                                return probe_url
                            else:
                                log.info(f"  ✗ Path-append: pág 2 OK ({len(p2_new)} novos) mas pág 3 repetida — provavelmente categoria, não paginação")
                        else:
                            # Página 3 sem resposta — aceitar com cautela
                            log.info(f"  ✓ Paginação path-append: {len(links)} imóveis (+{len(p2_new)} novos, pág 3 sem resposta) — {probe_url}")
                            return probe_url
                    else:
                        log.info(f"  ✗ Path-append retornou mesmos imóveis da pág 1 — ignorando")

    return None


def _url_to_template(page2_url: str, page_num: int = 2) -> Optional[str]:
    """Converte URL da página N em template com {N}."""
    pn = str(page_num)

    # Query-based patterns (nomes conhecidos de parâmetros de paginação)
    known_params = ["pagina", "page", "pag", "pg", "pagination", "p"]
    for param in known_params:
        pattern = rf"([?&]{param}=){pn}(&|$)"
        if re.search(pattern, page2_url, re.I):
            return re.sub(pattern, r"\g<1>{N}\g<2>", page2_url, flags=re.I)

    # Path-based patterns
    path_params = ["pagina", "page", "pag", "pg"]
    for param in path_params:
        pattern = rf"(/{param}/){pn}(/|$)"
        if re.search(pattern, page2_url, re.I):
            return re.sub(pattern, r"\g<1>{N}\g<2>", page2_url, flags=re.I)

    # Path-based: último segmento é o número → trocar por {N}
    parsed = urlparse(page2_url)
    path = parsed.path.rstrip("/")
    segments = path.split("/")
    if segments and segments[-1] == pn:
        segments[-1] = "{N}"
        new_path = "/".join(segments) + "/"
        template = f"{parsed.scheme}://{parsed.netloc}{new_path}"
        if parsed.query:
            template += f"?{parsed.query}"
        return template

    # GENERIC FALLBACK: procurar qualquer param com valor = page_num
    # (captura params desconhecidos como "pagination", "offset", etc.)
    skip_params = {"min", "max", "limit", "id", "cod", "ref", "ordem", "sort", "order", "tipo", "finalidade"}
    for match in re.finditer(rf"([?&])(\w+)={pn}(&|$)", page2_url):
        param_name = match.group(2).lower()
        if param_name not in skip_params:
            actual_param = match.group(2)  # Preservar case original
            pattern = rf"([?&]{re.escape(actual_param)}=){pn}(&|$)"
            return re.sub(pattern, r"\g<1>{N}\g<2>", page2_url)

    return None


# ─── Enriquecimento: scrape cada página de detalhe ───────────────────────────

def scrape_property_page(
    url: str,
    fallback_cidade: Optional[str] = None,
    fallback_estado: Optional[str] = None,
    template: Optional[SiteTemplate] = None,
) -> Optional[ImovelInput]:
    """
    Scrape de uma página de detalhe de imóvel.
    
    Cascata:
    1. Fetcher HTTP rápido (para sites SSR)
    2. StealthyFetcher (para sites com JS/Cloudflare)
    
    Depois extrai dados via Template/JSON-LD/Regex/LLM.
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
    del page  # Release Scrapling Adaptor object immediately (frees parsed DOM)

    if not html or len(html) < 200:
        log.warning(f"✗ HTML vazio — {url}")
        return None

    # Extrair dados via pipeline cascata (com template se disponível)
    result = extract_property_data(html, url, fallback_cidade, fallback_estado, template=template)
    del html  # Release HTML string after extraction

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
        # Timing por fase (segundos)
        self.phase_times: dict[str, float] = {}
        # Qualidade
        self.complete_count = 0
        self.template_hits = 0
        self.template_misses = 0
        self.llm_calls_total = 0
        self.pagination_type = "desconhecido"  # url_param | js_click | path | nenhuma

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


def _mem_info() -> str:
    """Return current process RSS and system available memory."""
    proc = psutil.Process()
    rss_mb = proc.memory_info().rss / 1024 / 1024
    vm = psutil.virtual_memory()
    avail_gb = vm.available / 1024**3
    return f"RSS={rss_mb:.0f}MB | Sys={avail_gb:.1f}GB free ({vm.percent}%)"


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
    from app.db import upsert_imoveis, mark_imoveis_indisponiveis, update_crawl_progress

    progress = on_progress or log.info
    stats = CrawlStats()

    def _push_progress(fase: str, message: str, done: int = 0, total: int = 0, logs: list[str] | None = None, finished: bool = False):
        """Escreve progresso no banco para o frontend pollinar."""
        try:
            update_crawl_progress(fonte_id, {
                "fase": fase,
                "message": message,
                "done": done,
                "total": total,
                "pct": round((done / total * 100) if total > 0 else 0),
                "enriched": stats.enriched,
                "failed": stats.failed,
                "elapsed": stats.elapsed_str,
                "logs": (logs or [])[-8:],  # últimas 8 entradas
                "finished": finished,
            })
        except Exception as e:
            log.warning(f"Falha ao salvar progresso: {e}")

    recent_logs: list[str] = []

    # ── FASE 1: Descoberta ────────────────────────────
    progress(f"\n{'='*60}")
    progress(f"CRAWL INICIADO — {site_url}")
    progress(f"{'='*60}")

    _push_progress("descoberta", "Buscando URLs de imóveis...", 0, 0)

    _t_discovery = time.time()
    urls = discover_property_urls(site_url, on_progress=progress)
    stats.urls_found = len(urls)
    stats.phase_times["descoberta_s"] = round(time.time() - _t_discovery, 1)

    if not urls:
        progress("Nenhum imóvel encontrado — finalizando")
        _push_progress("concluido", "Nenhum imóvel encontrado", 0, 0, finished=True)
        return stats

    # ── FASE 2: Enriquecimento (só salva quem tem dados) ──────────
    urls_to_enrich = urls[:MAX_ENRICH] if MAX_ENRICH > 0 else urls
    total = len(urls_to_enrich)

    # Template de CSS selectors (aprende nas primeiras 5, usa no resto)
    template = SiteTemplate()

    # Tracking de qualidade
    complete_items: list[str] = []    # preço + tipo + localização
    incomplete_items: list[str] = []  # parcial
    failed_urls: list[str] = []        # erro ou sem dados
    enriched_urls: list[str] = []      # todos enriquecidos com sucesso

    _lock = threading.Lock()
    processed_count = 0

    progress(f"\n{'─'*50}")
    if MAX_ENRICH > 0:
        progress(f"FASE 2: Enriquecimento (limitado: {total}/{len(urls)})")
    else:
        progress(f"FASE 2: Enriquecimento ({total} imóveis)")
    progress(f"Workers paralelos: {CONCURRENCY}")
    progress(f"Template learning: ativo (primeiras {SiteTemplate.LEARN_PAGES} páginas → sem LLM)")
    progress(f"{'─'*50}")

    _push_progress("descoberta", f"{stats.urls_found} URLs encontradas. Iniciando enriquecimento...", 0, total)
    _t_enrichment = time.time()

    def _enrich_one(url: str) -> tuple[str, Optional[ImovelInput]]:
        """Enriquece uma URL (roda em thread pool)."""
        try:
            return (url, scrape_property_page(url, cidade, estado, template=template))
        except Exception as e:
            log.error(f"  ✗ Erro thread {url}: {e}\n{traceback.format_exc()}")
            return (url, None)

    SAVE_EVERY = max(CONCURRENCY * 5, 20)  # salvar a cada ~20 resultados (menor = menos pico de RAM)

    for batch_start in range(0, total, SAVE_EVERY):
      try:
        batch_urls = urls_to_enrich[batch_start : batch_start + SAVE_EVERY]
        batch_num = batch_start // SAVE_EVERY + 1
        total_batches = (total + SAVE_EVERY - 1) // SAVE_EVERY

        tmpl_status = "⚡ template" if template.is_ready else f"📚 aprendendo ({template._sample_count}/{SiteTemplate.LEARN_PAGES})"
        progress(f"\n  Batch {batch_num}/{total_batches} — {len(batch_urls)} URLs (x{CONCURRENCY} paralelo) [{tmpl_status}]")

        batch_results: list[ImovelInput] = []

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            future_map = {pool.submit(_enrich_one, u): u for u in batch_urls}

            for future in as_completed(future_map):
                url_done = future_map[future]
                try:
                    _, data = future.result()
                except Exception as e:
                    data = None
                    log.error(f"  ✗ Exceção {url_done}: {e}")

                with _lock:
                    processed_count += 1

                    if data:
                        stats.enriched += 1
                        enriched_urls.append(url_done)
                        batch_results.append(data)
                        label = f"{data.tipo or '?'} — {('R$' + str(int(data.preco))) if data.preco else 's/preço'} — {data.bairro or data.cidade or '?'}"
                        recent_logs.append(f"✓ {label}")
                        has_preco = data.preco is not None and data.preco > 0
                        has_tipo = bool(data.tipo)
                        has_local = bool(data.bairro or data.cidade)
                        if has_preco and has_tipo and has_local:
                            complete_items.append(url_done)
                        else:
                            faltando = []
                            if not has_preco: faltando.append("preço")
                            if not has_tipo: faltando.append("tipo")
                            if not has_local: faltando.append("localização")
                            incomplete_items.append(f"{url_done} (falta: {', '.join(faltando)})")
                    else:
                        stats.failed += 1
                        failed_urls.append(url_done)
                        recent_logs.append(f"✗ sem dados")

        # Salvar batch no DB
        if batch_results:
            upsert_imoveis(fonte_id, batch_results)
            progress(
                f"  ✓ Batch {batch_num}: {len(batch_results)} salvos "
                f"(total: {stats.enriched}/{total} | falhas: {stats.failed})"
            )

        # Progresso geral
        pct = (processed_count / total) * 100
        tmpl_info = ""
        if template.is_ready:
            tmpl_info = f" | ⚡template: {template.hits} hits, {template.misses} miss, {template.llm_calls} LLM"
        elif template.learning:
            tmpl_info = f" | 📚 aprendendo ({template._sample_count}/{SiteTemplate.LEARN_PAGES})"
        progress(f"  📊 Progresso: {processed_count}/{total} ({pct:.0f}%) — {stats.elapsed_str}{tmpl_info}")

        _push_progress(
            "enriquecimento",
            f"Extraindo dados dos imóveis... ({processed_count}/{total})",
            processed_count, total, recent_logs,
        )
      except Exception as batch_err:
        log.error(f"  ✗ BATCH {batch_num} CRASH: {batch_err}\n{traceback.format_exc()}")
        # Continue to next batch instead of dying
        continue
      finally:
        # Free memory between batches (prevents OOM on large sites)
        batch_results = None  # release refs before gc
        gc.collect()
        # Log memory stats
        progress(f"  💾 Memória: {_mem_info()}")

    stats.phase_times["enriquecimento_s"] = round(time.time() - _t_enrichment, 1)

    # ── FASE 3: Marcar indisponíveis ──────────────────
    progress(f"\n{'─'*50}")
    progress(f"FASE 3: Marcando imóveis indisponíveis")
    progress(f"{'─'*50}")

    _push_progress("finalizando", "Finalizando e marcando indisponíveis...", total, total, recent_logs)

    _t_finalizacao = time.time()
    disabled = mark_imoveis_indisponiveis(fonte_id, urls)
    progress(f"✓ {disabled} imóveis marcados como indisponíveis")
    stats.phase_times["finalizacao_s"] = round(time.time() - _t_finalizacao, 1)

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
    # Template stats
    tpl_total = template.hits + template.misses
    if tpl_total > 0 or template.llm_calls > 0:
        progress(f"  🎯 Template: {'ATIVO' if template.is_ready else 'não confirmado'}")
        progress(f"     CSS hits:   {template.hits}")
        progress(f"     CSS misses: {template.misses}")
        progress(f"     LLM calls:  {template.llm_calls}")
        if tpl_total > 0:
            progress(f"     Hit rate:   {template.hits/tpl_total:.0%}")
        progress(f"     Selectors:  {len(template.confirmed)} campos")
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

    # Consolidar stats de template + qualidade
    stats.complete_count = n_complete
    stats.template_hits = template.hits
    stats.template_misses = template.misses
    stats.llm_calls_total = template.llm_calls

    # Progresso final para o frontend
    _push_progress(
        "concluido",
        f"Concluído! {n_complete} completos, {n_incomplete} parciais, {n_failed} erros",
        total, total, recent_logs, finished=True,
    )

    return stats
