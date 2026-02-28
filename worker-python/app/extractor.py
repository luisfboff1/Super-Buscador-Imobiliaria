"""
Extrator de dados de imóveis.

Estratégia em cascata com merge:
1. JSON-LD  — dados estruturados embutidos pela imobiliária (grátis, perfeito)
2. Regex    — preço (R$) e área (m²) via regex universal (grátis, funciona em todos os sites)
3. LLM      — Groq llama-3.1-8b-instant preenche TODOS os campos faltantes

O LLM é chamado sempre que QUALQUER campo estiver faltando (preco, tipo, transacao,
quartos, banheiros, vagas, area, bairro, descricao). Queremos o máximo de dados possível.
"""

import os
import re
import json
from typing import Optional

from bs4 import BeautifulSoup
from groq import Groq
from openai import OpenAI

from app.db import ImovelInput
from app.logger import get_logger

log = get_logger("extractor")

# ─── LLM clients (lazy init) ──────────────────────────────────────────────────

_groq_client: Optional[Groq] = None
_openai_client: Optional[OpenAI] = None


def _get_groq() -> Groq:
    global _groq_client
    if _groq_client is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY não configurada")
        # max_retries=0: desliga retry automático do SDK (que espera 15s!)
        _groq_client = Groq(api_key=api_key, max_retries=0)
    return _groq_client


def _get_openai() -> Optional[OpenAI]:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return None
        _openai_client = OpenAI(api_key=api_key)
    return _openai_client


# ─── LLM universal: OpenAI primary → Groq fallback ─────────────────────────────

def _llm_chat(
    messages: list[dict],
) -> Optional[str]:
    """
    Chama LLM com fallback automático: OpenAI (rápido, confiável) → Groq.
    Sem limite de tokens — modelo decide quanto usar.
    Retorna o texto da resposta ou None.
    """
    # 1. Tentar OpenAI (confiável, sem truncamento)
    openai_client = _get_openai()
    if openai_client is not None:
        try:
            # gpt-5-nano é reasoning: não aceita temperature.
            # Sem max_completion_tokens → modelo decide quanto raciocinar e quantos tokens produzir.
            response = openai_client.chat.completions.create(
                model="gpt-5-nano",
                messages=messages,
            )
            text = response.choices[0].message.content or ""
            usage = response.usage
            tokens_in = usage.prompt_tokens if usage else 0
            tokens_out = usage.completion_tokens if usage else 0
            log.debug(f"[openai] OK (tokens: {tokens_in}→{tokens_out})")
            return text
        except Exception as openai_err:
            log.warning(f"[openai] Falhou: {openai_err}")

    # 2. Fallback: Groq (grátis, mas trunca respostas longas)
    try:
        client = _get_groq()
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages,
        )
        text = response.choices[0].message.content or ""
        usage = response.usage
        tokens_in = usage.prompt_tokens if usage else 0
        tokens_out = usage.completion_tokens if usage else 0
        log.debug(f"[groq] OK (tokens: {tokens_in}→{tokens_out})")
        return text
    except Exception as groq_err:
        log.warning(f"[groq] Também falhou: {groq_err}")
        return None


# ─── 1. Extração de imagens via BeautifulSoup ────────────────────────────────

def extract_images(html: str) -> list[str]:
    """Extrai URLs de imagens do HTML (sem LLM)."""
    soup = BeautifulSoup(html, "lxml")
    urls: set[str] = set()

    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or img.get("data-lazy-src") or img.get("data-original")
        if src and src.startswith("http") and not re.search(r"logo|icon|banner|avatar|sprite", src, re.I):
            urls.add(src)

    for meta in soup.find_all("meta", property="og:image"):
        content = meta.get("content", "")
        if content.startswith("http"):
            urls.add(content)

    return list(urls)[:30]


# ─── Micro-LLM: extrai bairro/cidade APENAS do título (pós-processamento do template) ────────

def _llm_locate_from_titulo(titulo: str, url: str) -> Optional[ImovelInput]:
    """
    Micro-chamada LLM: extrai bairro e cidade a partir SOMENTE do título.
    Usada no fast path do template quando bairro/cidade ficam nulos.
    Funciona para qualquer site cujo título contenha localização (padrão BR comum).
    """
    messages = [
        {
            "role": "system",
            "content": (
                "Você extrai bairro e cidade de títulos de imóveis brasileiros. "
                "Retorne SOMENTE JSON: {\"bairro\": \"...\", \"cidade\": \"...\"}. "
                "Use null para campos ausentes. Sem explicações. "
                "Padrão comum: \"Tipo à venda, R$ X, Bairro em Cidade | Imob\". "
                "Bairro deve ser nome geográfico real (máx 60 chars)."
            ),
        },
        {"role": "user", "content": f"Título: {titulo[:300]}"},
    ]
    raw = _llm_chat(messages)
    if not raw:
        return None
    try:
        m = re.search(r"\{[^}]+\}", raw, re.S)
        if not m:
            return None
        data = json.loads(m.group())
        bairro = _sanitize_location(data.get("bairro")) if data.get("bairro") and data["bairro"] != "null" else None
        cidade = _sanitize_location(data.get("cidade")) if data.get("cidade") and data["cidade"] != "null" else None
        if not bairro and not cidade:
            return None
        return ImovelInput(url_anuncio=url, bairro=bairro, cidade=cidade)
    except Exception:
        return None


# ─── Sanitização de localização (cidade/bairro) ──────────────────────────────

_LOCATION_NOISE_RE = re.compile(
    r"R\$[\s\d.,]"               # preço (R$ 1.234)
    r"|\bà venda\b|\bpara alugar\b|\bpara locação\b|\bimóv[eé]\b"  # frases de transação
    r"|\bImobili[áa]ria\b",       # nome de empresa
    re.I,
)


def _sanitize_location(val) -> Optional[str]:
    """Retorna None se val não parece nome geográfico real.

    Rejeita: sep ' | ', newlines, valores > 80 chars, preços ou frases
    de transação — padrões que indicam que a extração pegou o título da
    página em vez de um bairro/cidade verdadeiro.
    """
    if not val:
        return None
    v = str(val).strip()
    if " | " in v or "\n" in v or "\r" in v:
        return None
    if len(v) > 80:
        return None
    if _LOCATION_NOISE_RE.search(v):
        return None
    return v or None


# ─── 2. Extração via JSON-LD (grátis, sem LLM) ──────────────────────────────

def extract_from_json_ld(html: str, url: str) -> Optional[ImovelInput]:
    """Extrai dados de JSON-LD (schema.org) embutido no HTML."""
    soup = BeautifulSoup(html, "lxml")

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            raw = script.string
            if not raw:
                continue
            data = json.loads(raw)
            items = data if isinstance(data, list) else [data]

            for item in items:
                item_type = str(item.get("@type", "")).lower()

                # Pular schemas de organização/website/breadcrumb
                skip_types = ["organization", "localbusiness", "website", "webpage",
                              "breadcrumb", "searchaction", "person", "imageobject",
                              "agent", "broker", "service"]
                if any(t in item_type for t in skip_types):
                    continue

                type_match = any(
                    t in item_type
                    for t in ["realestate", "residence", "house", "apartment", "property", "product", "offer", "place"]
                )
                if not type_match:
                    continue

                offers = item.get("offers", {})
                if isinstance(offers, list):
                    offers = offers[0] if offers else {}

                preco_raw = offers.get("price") or item.get("price") or offers.get("lowPrice")
                preco = float(preco_raw) if preco_raw else None

                address = item.get("address", {})
                if isinstance(address, str):
                    address = {}

                result = ImovelInput(
                    url_anuncio=url,
                    titulo=item.get("name") or item.get("headline"),
                    descricao=(item.get("description") or "")[:500] or None,
                    cidade=_sanitize_location(address.get("addressLocality")),
                    bairro=_sanitize_location(address.get("streetAddress") or address.get("addressRegion", "").split(",")[0].strip() or None),
                    estado=(address.get("addressRegion", "") or "")[-2:].upper() if address.get("addressRegion") else None,
                    preco=preco,
                    area_m2=_parse_floor_size(item.get("floorSize")),
                    quartos=_safe_int(item.get("numberOfRooms") or item.get("numberOfBedrooms")),
                    banheiros=_safe_int(item.get("numberOfBathroomsTotal") or item.get("numberOfBathrooms")),
                    vagas=_safe_int(item.get("numberOfParkingSpaces")),
                )

                if result.titulo or result.preco:
                    preco_str = f"R${result.preco:,.0f}" if result.preco else "s/preço"
                    log.info(f"✓ [json-ld] {result.titulo or 'sem título'} — {preco_str} — {result.bairro or '?'}")
                    return result

        except (json.JSONDecodeError, TypeError, ValueError):
            continue

    return None


def _parse_floor_size(val) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, dict):
        val = val.get("value", val.get("unitText"))
    if isinstance(val, (int, float)):
        return float(val) if val > 0 else None
    if isinstance(val, str):
        m = re.search(r"[\d.,]+", val.replace(".", "").replace(",", "."))
        return float(m.group()) if m else None
    return None


def _safe_int(val) -> Optional[int]:
    if val is None:
        return None
    try:
        n = int(val)
        return n if n > 0 else None
    except (ValueError, TypeError):
        return None


# ─── 3. Extração rápida via regex (preço + área — universal) ──────────────────

def extract_quick_regex(html: str, url: str) -> Optional[ImovelInput]:
    """
    Extração rápida com regex universais: preço (R$), área (m²), título.
    Nenhum CSS hardcoded — funciona em qualquer site.
    """
    soup = BeautifulSoup(html, "lxml")

    # Remove ruído
    for tag in soup.find_all(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()

    text = soup.get_text(" ", strip=True)
    text_lower = text.lower()

    # Título: og:title ou <h1> (universal)
    titulo = None
    og_title = soup.find("meta", property="og:title")
    if og_title:
        candidate = og_title.get("content", "").strip()
        # Valida se parece um título de imóvel (tem tipo, preço, bairro ou área)
        _IMOVEL_WORDS = r"(apartamento|casa|sobrado|terreno|sala|loja|galpão|galp.o|cobertura|flat|kitnet|chácara|sítio|r\$|m²|quarto|dormit)"
        if candidate and re.search(_IMOVEL_WORDS, candidate, re.I):
            titulo = candidate
    if not titulo:
        h1 = soup.find("h1")
        if h1:
            t = h1.get_text(strip=True)
            # h1 curto e genérico (ex: "Simule aqui:") não serve
            if len(t) > 20:
                titulo = t

    # Preço: regex R$ no texto (universal em sites BR)
    preco = _extract_preco(text_lower)

    # Área: regex m² (universal)
    area = _extract_area(text_lower)

    # Transação: detectar da URL ou título (heurística grátis)
    transacao = _detect_transacao(url, titulo or "", text_lower)

    # Tipo: detectar de título ou texto
    tipo = _detect_tipo(titulo or "", text_lower)

    # Quartos, banheiros, vagas: regex universal
    quartos = _extract_quartos(text_lower)
    banheiros = _extract_banheiros(text_lower)
    vagas = _extract_vagas(text_lower)

    if not titulo and not preco:
        return None

    result = ImovelInput(
        url_anuncio=url,
        titulo=titulo,
        preco=preco,
        area_m2=area,
        transacao=transacao,
        tipo=tipo,
        quartos=quartos,
        banheiros=banheiros,
        vagas=vagas,
    )

    preco_str = f"R${result.preco:,.0f}" if result.preco else "s/preço"
    log.info(f"✓ [regex] {result.titulo or 'sem título'} — {preco_str} — {result.fields_count} campos")
    return result


def _detect_transacao(url: str, titulo: str, text: str) -> Optional[str]:
    """Detecta tipo de transação a partir da URL, título e texto."""
    # Prioridade 1: URL + título (mais confiável — sem ruído de menus de navegação)
    primary = f"{url.lower()} {titulo.lower()}"
    has_venda_primary = bool(re.search(r"(comprar|venda|à venda|a venda|para vender)", primary))
    has_aluguel_primary = bool(re.search(r"(alugar|aluguel|locação|para alugar|locacao)", primary))

    if has_venda_primary and not has_aluguel_primary:
        return "venda"
    if has_aluguel_primary and not has_venda_primary:
        return "aluguel"

    # Prioridade 2: corpo do texto (excluindo início que costuma ter menu de nav)
    body = text[200:700] if len(text) > 200 else text[:500]
    has_venda = has_venda_primary or bool(re.search(r"(comprar|venda|à venda|a venda|para vender)", body))
    has_aluguel = has_aluguel_primary or bool(re.search(r"(alugar|aluguel|locação|para alugar|locacao)", body))

    if has_venda and has_aluguel:
        return "ambos"
    if has_venda:
        return "venda"
    if has_aluguel:
        return "aluguel"
    return None


def _extract_preco(text: str) -> Optional[float]:
    """Extrai preço de venda do texto."""
    # Padrão: R$ xxx.xxx,xx ou R$ xxx.xxx
    matches = re.findall(r"r\$\s*([\d.,]+)", text)
    precos = []
    for m in matches:
        try:
            # Remove pontos de milhar, troca vírgula por ponto
            clean = m.replace(".", "").replace(",", ".")
            val = float(clean)
            if val > 10_000:  # preço realista de imóvel
                precos.append(val)
        except ValueError:
            continue
    # Retorna o primeiro preço válido (o do imóvel principal, que aparece antes das sugestões de outros imóveis)
    return precos[0] if precos else None


def _extract_area(text: str) -> Optional[float]:
    """Extrai área em m²."""
    m = re.search(r"([\d.,]+)\s*m[²2]", text)
    if m:
        try:
            return float(m.group(1).replace(".", "").replace(",", "."))
        except ValueError:
            pass
    return None


def _detect_tipo(titulo: str, text: str) -> Optional[str]:
    """Detecta tipo de imóvel do título ou texto."""
    combined = f"{titulo} {text[:500]}".lower()
    # Ordem importa: mais específico primeiro
    tipo_patterns = [
        ("cobertura", r"cobertura"),
        ("kitnet", r"kitnet|kitnete|conjugado"),
        ("sobrado", r"sobrado"),
        ("duplex", r"duplex|d[úu]plex"),
        ("triplex", r"triplex"),
        ("flat", r"\bflat\b"),
        ("loft", r"\bloft\b"),
        ("apartamento", r"apartamento|\bapto?\b|\bap\b"),
        ("casa", r"\bcasa\b"),
        ("terreno", r"terreno|\blote\b"),
        ("chacara", r"ch[áa]cara|s[íi]tio"),
        ("galpao", r"galp[ãa]o|barrac[ãa]o"),
        ("sala", r"\bsala comercial\b"),
        ("loja", r"\bloja\b"),
        ("pavilhao", r"pavilh[ãa]o"),
        ("comercial", r"comercial|ponto comercial"),
        ("rural", r"\brural\b|\bfazenda\b"),
        ("condominio", r"condom[íi]nio fechado"),
        ("box", r"\bbox\b"),
        ("predio", r"pr[ée]dio"),
    ]
    for tipo, pattern in tipo_patterns:
        if re.search(pattern, combined):
            return tipo
    return None


def _extract_quartos(text: str) -> Optional[int]:
    """Extrai número de quartos/dormitórios do texto."""
    patterns = [
        r"(\d+)\s*(?:quartos?|dormit[óo]rios?|dorms?|su[íi]tes?\s*e\s*\d+\s*(?:quarto|dorm))",
        r"(\d+)\s*(?:dorm)",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            val = int(m.group(1))
            if 1 <= val <= 20:
                return val
    # Padrão alternativo: "suite" isolada pode significar 1
    if re.search(r"su[íi]te", text) and not re.search(r"\d+\s*su[íi]te", text):
        return None  # Não inferir 1
    return None


def _extract_banheiros(text: str) -> Optional[int]:
    """Extrai número de banheiros do texto."""
    m = re.search(r"(\d+)\s*(?:banheiros?|bwc|wcs?|lavabos?)", text)
    if m:
        val = int(m.group(1))
        if 1 <= val <= 20:
            return val
    return None


def _extract_vagas(text: str) -> Optional[int]:
    """Extrai número de vagas de garagem do texto."""
    m = re.search(r"(\d+)\s*(?:vagas?|garagens?|box)", text)
    if m:
        val = int(m.group(1))
        if 1 <= val <= 20:
            return val
    return None


# ─── Site Template Learning ──────────────────────────────────────────────────

def _build_css_selector(el) -> Optional[str]:
    """Constrói um CSS selector reproduzível para um elemento BS4."""
    if not el or not hasattr(el, 'name') or el.name in ("[document]", None):
        return None

    parts = []
    current = el

    for _ in range(3):  # max 3 níveis acima
        if not current or not hasattr(current, 'name') or current.name in ("[document]", "html", "body", None):
            break

        tag = current.name
        eid = current.get("id", "")
        if eid and not re.match(r"^[0-9]", eid) and len(eid) < 40:
            parts.insert(0, f"#{eid}")
            break

        classes = current.get("class", [])
        stable = [
            c for c in classes
            if c and len(c) < 40
            and not re.match(
                r'^(is-|has-|active|open|show|selected|hover|focus|'
                r'ng-|v-|js-|wp-block|post-\d|entry-|page-|col-|row|'
                r'animate|fade|slide|transition)', c
            )
        ]

        if stable:
            parts.insert(0, f"{tag}.{'.' .join(sorted(stable)[:2])}")
            break
        else:
            parts.insert(0, tag)

        current = current.parent

    return " ".join(parts) if parts else None


def _find_selectors_for_value(soup, value, field: str) -> list[str]:
    """Acha CSS selectors de elementos contendo o valor extraído."""
    str_val = str(value).strip()
    if not str_val or len(str_val) < 1:
        return []

    search_patterns: list[str] = []

    if field == "preco":
        try:
            v = float(str_val)
            search_patterns.append(re.escape(f"{v:,.0f}".replace(",", ".")))
            search_patterns.append(re.escape(str(int(v))))
        except Exception:
            search_patterns.append(re.escape(str_val))
    elif field == "area_m2":
        # Requer contexto de unidade para evitar falso positivo com vagas/quartos
        try:
            v = float(str_val)
            num = re.escape(str(int(v)))
            search_patterns.append(f"{num}\\s*m[²2]")
            search_patterns.append(f"{num}\\s*m\\s*2")
            # Fallback sem contexto apenas se nenhum match com unidade for encontrado
        except Exception:
            search_patterns.append(re.escape(str_val))
    elif field in ("quartos", "banheiros", "vagas"):
        # Buscar "N + keyword" para evitar falsos positivos com números soltos
        num = re.escape(str_val)
        keywords = {
            "quartos": ["quarto", "dormit", "dorm"],
            "banheiros": ["banheir", "bwc", "wc"],
            "vagas": ["vaga", "garagem", "box"],
        }
        for kw in keywords.get(field, []):
            search_patterns.append(f"{num}\\s*{re.escape(kw)}")
    elif field == "titulo":
        words = str_val.split()[:4]
        if len(words) >= 2:
            search_patterns.append(re.escape(" ".join(words)))
    else:
        if len(str_val) >= 3:
            search_patterns.append(re.escape(str_val))

    if not search_patterns:
        return []

    results: list[str] = []
    for pattern in search_patterns:
        try:
            for text_node in soup.find_all(string=re.compile(pattern, re.I)):
                parent = text_node.parent
                if parent and parent.name not in ("script", "style", "head", "[document]", None):
                    sel = _build_css_selector(parent)
                    if sel and sel not in results:
                        results.append(sel)
        except re.error:
            continue

    return results[:5]


def _parse_template_field(field: str, raw_text: str):
    """Parse valor de texto bruto para o tipo correto do campo."""
    if not raw_text:
        return None
    text = raw_text.strip()

    if field == "preco":
        return _extract_preco(text.lower())
    if field == "area_m2":
        return _extract_area(text.lower())
    if field in ("quartos", "banheiros", "vagas"):
        m = re.search(r"(\d+)", text)
        return int(m.group(1)) if m else None
    if field == "tipo":
        t = _detect_tipo(text, text.lower())
        return t if t in VALID_TIPOS else None
    if field == "transacao":
        return _detect_transacao("", text, text.lower())
    if field == "descricao":
        return text[:500] if len(text) >= 10 else None
    # Strings: titulo, bairro, cidade, estado
    return text if len(text) >= 2 else None


class SiteTemplate:
    """
    Aprende CSS selectors de um site para extrair dados sem LLM.

    Estratégia:
    1. Primeiras 5 URLs: LLM extrai dados normalmente
    2. Para cada URL, buscamos no HTML os CSS selectors dos valores encontrados
    3. Selectors que aparecem em 2+ páginas são confirmados
    4. URLs restantes usam CSS selectors (sem LLM, ~100x mais rápido)

    Lida com tipos diferentes (casa vs terreno):
    - Selectors são POR CAMPO, independentes
    - Se quartos não existe num terreno, o selector retorna vazio = null
    - Isso é correto: terrenos não têm quartos
    """

    LEARN_PAGES = 5
    MIN_VOTES = 2
    MIN_FIELDS = 3   # mínimo de campos confirmados
    DISABLE_MISS_RATE = 0.35  # desabilita se >35% falhas

    ALL_FIELDS = (
        "titulo", "preco", "tipo", "bairro", "cidade", "estado",
        "transacao", "quartos", "banheiros", "vagas", "area_m2", "descricao",
    )

    def __init__(self):
        self._votes: dict[str, dict[str, int]] = {}
        self.confirmed: dict[str, str] = {}  # field -> css_selector
        self.is_ready = False
        self._sample_count = 0
        # Métricas
        self.hits = 0
        self.misses = 0
        self.llm_calls = 0

    @property
    def learning(self) -> bool:
        return not self.is_ready and self._sample_count < self.LEARN_PAGES

    def add_sample(self, html: str, data: 'ImovelInput'):
        """Aprende selectors de uma página com dados extraídos."""
        if self.is_ready:
            return

        soup = BeautifulSoup(html, "lxml")
        for tag in soup.find_all(["script", "style", "svg", "noscript", "iframe"]):
            tag.decompose()

        for field in self.ALL_FIELDS:
            value = getattr(data, field, None)
            if value is None:
                continue

            selectors = _find_selectors_for_value(soup, value, field)
            if not selectors:
                continue

            if field not in self._votes:
                self._votes[field] = {}
            for sel in selectors[:3]:
                self._votes[field][sel] = self._votes[field].get(sel, 0) + 1

        self._sample_count += 1
        log.debug(f"📘 Template amostra {self._sample_count}/{self.LEARN_PAGES}")

        if self._sample_count >= self.LEARN_PAGES:
            self._confirm()

    # Campos opcionais: não aparecem em todos os tipos de imóvel (terreno não tem
    # banheiros, sala não tem quartos), então MIN_VOTES=1 é suficiente para eles.
    OPTIONAL_FIELDS = {"banheiros", "vagas", "area_m2", "quartos", "descricao", "estado"}

    def _confirm(self):
        """Confirma selectors com votos suficientes."""
        for field, candidates in self._votes.items():
            if not candidates:
                continue
            best_sel = max(candidates, key=candidates.get)
            best_votes = candidates[best_sel]
            min_votes_needed = 1 if field in self.OPTIONAL_FIELDS else self.MIN_VOTES
            if best_votes >= min_votes_needed:
                self.confirmed[field] = best_sel

        has_core = bool({"titulo", "preco"} & set(self.confirmed))
        if has_core and len(self.confirmed) >= self.MIN_FIELDS:
            self.is_ready = True
            fields_str = ", ".join(self.confirmed.keys())
            log.info(f"🎯 Template CONFIRMADO — {len(self.confirmed)} selectors: {fields_str}")
        else:
            log.info(
                f"⚠ Template não confirmado: {len(self.confirmed)} selectors "
                f"({', '.join(self.confirmed.keys()) or 'nenhum'})"
            )

    def extract(
        self, html: str, url: str,
        fallback_cidade: Optional[str] = None,
        fallback_estado: Optional[str] = None,
    ) -> Optional[ImovelInput]:
        """Extrai dados usando CSS selectors (sem LLM)."""
        if not self.is_ready:
            return None

        soup = BeautifulSoup(html, "lxml")
        data: dict = {}

        for field, selector in self.confirmed.items():
            try:
                el = soup.select_one(selector)
                if el:
                    raw = el.get_text(strip=True)
                    if raw:
                        parsed = _parse_template_field(field, raw)
                        if parsed is not None:
                            data[field] = parsed
            except Exception:
                continue

        if len(data) < 2:
            self.misses += 1
            # Se taxa de falha alta, desabilitar template
            total = self.hits + self.misses
            if total > 15 and self.misses / total > self.DISABLE_MISS_RATE:
                log.warning(
                    f"⚠ Template desabilitado: {self.misses}/{total} falhas "
                    f"({self.misses/total:.0%})"
                )
                self.is_ready = False
            return None

        self.hits += 1

        result = ImovelInput(
            url_anuncio=url,
            titulo=data.get("titulo"),
            tipo=data.get("tipo") if data.get("tipo") in VALID_TIPOS else None,
            transacao=data.get("transacao"),
            cidade=_sanitize_location(data.get("cidade")) or fallback_cidade,
            bairro=_sanitize_location(data.get("bairro")),
            estado=data.get("estado") or fallback_estado,
            preco=data.get("preco"),
            area_m2=data.get("area_m2"),
            quartos=data.get("quartos"),
            banheiros=data.get("banheiros"),
            vagas=data.get("vagas"),
            descricao=data.get("descricao"),
        )

        result.imagens = extract_images(html)
        return result

    def __repr__(self):
        status = "READY" if self.is_ready else f"learning {self._sample_count}/{self.LEARN_PAGES}"
        return (
            f"SiteTemplate({status}, {len(self.confirmed)} sel, "
            f"hits={self.hits}, miss={self.misses}, llm={self.llm_calls})"
        )


# ─── 4. Extração via LLM (Groq) — o "agente" que completa tudo ──────────────

SYSTEM_PROMPT = """Você é um extrator de dados de imóveis do mercado imobiliário brasileiro.
Analise o conteúdo da página de um anúncio de imóvel e extraia TODOS os dados disponíveis.

Regras OBRIGATÓRIAS:
- Retorne APENAS dados explicitamente presentes na página. Não invente valores.
- Se um campo não estiver na página, retorne null.
- EXTRAIA TUDO QUE CONSEGUIR: analise cuidadosamente todo o texto procurando cada campo.
- "transacao" é OBRIGATÓRIO: analise se o imóvel está à venda ("venda"), para alugar ("aluguel"), ou ambos ("ambos"). Use pistas da URL, título, e texto. Se o site é de venda e não menciona aluguel, retorne "venda".
- "tipo" é OBRIGATÓRIO: identifique o tipo do imóvel (casa, apartamento, terreno, sobrado, kitnet, etc). Deduza do título, descrição ou contexto.
- "quartos": procure por "quartos", "dormitórios", "dorm", "suítes" — conte o total de dormitórios.
- "banheiros": procure por "banheiros", "banheiro", "WC", "lavabo" — conte o total.
- "vagas": procure por "vagas", "garagem", "estacionamento", "box" — conte o total de vagas de garagem.
- "area_m2": procure por "m²", "m2", "metros quadrados", "área útil", "área total", "área privativa".
- "bairro": nome do bairro, loteamento ou condomínio (ex: "Centro", "Petrópolis", "Jardim X"). Procure em: (1) endereço explícito na página, (2) TÍTULO DA PÁGINA — títulos BR frequentemente seguem o padrão ", Bairro em Cidade |" ou "em Bairro, Cidade -", por exemplo: "Casa à venda, R$ 500.000, Nossa Senhora da Saúde em Caxias do Sul | Imobiliária" → bairro="Nossa Senhora da Saúde". DEVE ser um nome geográfico real com no máximo 60 caracteres. NUNCA retorne o título completo da página, preço, nome de imobiliária ou frases como "casa à venda".
- "cidade": nome da cidade ou município (ex: "Porto Alegre", "Caxias do Sul", "Florianópolis"). Somente o nome da cidade, sem caracteres " | ", preços ou descrições longas.
- "preco": valor numérico em reais. Se houver preço de venda E aluguel, retorne o de venda.
- Estado deve ser a sigla com 2 letras (RS, SP, SC, MG, etc).
- Descrição: máximo 500 caracteres, resumindo o texto principal do anúncio.
- Se houver uma lista de características (ex: "3 quartos, 2 banheiros, 1 vaga"), extraia cada valor."""

SCHEMA_GUIDE = """{
  "titulo": "string|null",
  "tipo": "casa|apartamento|terreno|comercial|rural|cobertura|kitnet|sobrado|flat|loft|galpao|sala|loja|chacara|predio|box|barracao|duplex|triplex|condominio|pavilhao|outro|null",
  "transacao": "venda|aluguel|ambos|null",
  "cidade": "string|null",
  "bairro": "string|null",
  "estado": "string|null — sigla 2 letras",
  "preco": "number|null — valor de VENDA em reais",
  "areaM2": "number|null",
  "quartos": "integer|null",
  "banheiros": "integer|null",
  "vagas": "integer|null",
  "descricao": "string|null — máximo 500 caracteres"
}"""

VALID_TIPOS = {
    "casa", "apartamento", "terreno", "comercial", "rural", "cobertura",
    "kitnet", "sobrado", "flat", "loft", "galpao", "sala", "loja",
    "chacara", "predio", "box", "barracao", "duplex", "triplex", "condominio",
    "pavilhao",
    "outro",
}


def html_to_clean_text(html: str) -> str:
    """Converte HTML para texto limpo para o LLM."""
    soup = BeautifulSoup(html, "lxml")

    # Captura o <title> ANTES de remover qualquer tag — é muito útil para bairro/cidade
    page_title = ""
    title_tag = soup.find("title")
    if title_tag:
        page_title = title_tag.get_text(strip=True)

    # Remove ruído
    for tag in soup.find_all([
        "script", "style", "iframe", "noscript", "svg", "nav", "header", "footer",
    ]):
        tag.decompose()

    # Remove elementos de cookie/popup/modal
    for sel in ["[class*='cookie']", "[class*='popup']", "[id*='modal']"]:
        for el in soup.select(sel):
            el.decompose()

    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Limitar tokens (~6000 chars ≈ 1500 tokens)
    if len(text) > 6000:
        text = text[:6000]

    # Garante que o título da página aparece primeiro (fundamental para extração de bairro/cidade)
    if page_title and page_title not in text[:200]:
        text = f"TÍTULO DA PÁGINA: {page_title}\n\n" + text

    return text.strip()


def extract_via_llm(html: str, url: str) -> Optional[ImovelInput]:
    """Extrai dados via Groq LLM (llama-3.1-8b-instant)."""
    clean_text = html_to_clean_text(html)

    if len(clean_text) < 100:
        log.debug(f"Texto muito curto para LLM: {url} ({len(clean_text)} chars)")
        return None

    try:
        text = _llm_chat(
            messages=[
                {
                    "role": "system",
                    "content": (
                        SYSTEM_PROMPT
                        + f"\n\nResponda APENAS com um objeto JSON válido seguindo este schema:\n{SCHEMA_GUIDE}\n"
                        + "Nenhum texto antes ou depois do JSON."
                    ),
                },
                {"role": "user", "content": f"URL: {url}\n\n{clean_text}"},
            ],
        )

        if not text:
            log.warning(f"✗ LLM sem resposta — {url}")
            return None

        # Extrair JSON da resposta
        json_match = re.search(r"\{[\s\S]*\}", text)
        if not json_match:
            log.warning(f"✗ Sem JSON na resposta LLM — {url}")
            return None

        data = json.loads(json_match.group())

        result = ImovelInput(
            url_anuncio=url,
            titulo=data.get("titulo"),
            tipo=data.get("tipo") if data.get("tipo") in VALID_TIPOS else None,
            transacao=data.get("transacao"),
            cidade=_sanitize_location(data.get("cidade")),
            bairro=_sanitize_location(data.get("bairro")),
            estado=data.get("estado"),
            preco=float(data["preco"]) if data.get("preco") and float(data["preco"]) > 1000 else None,
            area_m2=float(data["areaM2"]) if data.get("areaM2") and float(data["areaM2"]) > 0 else None,
            quartos=int(data["quartos"]) if data.get("quartos") and int(data["quartos"]) > 0 else None,
            banheiros=int(data["banheiros"]) if data.get("banheiros") and int(data["banheiros"]) > 0 else None,
            vagas=int(data["vagas"]) if data.get("vagas") and int(data["vagas"]) > 0 else None,
            descricao=data.get("descricao"),
        )

        preco_str = f"R${result.preco:,.0f}" if result.preco else "s/preço"
        log.info(f"✓ [llm] {result.titulo or url[:40]} — {preco_str} — {result.bairro or '?'}")
        return result

    except Exception as e:
        log.error(f"✗ LLM falhou para {url}: {e}")
        return None


# ─── Merge helper ─────────────────────────────────────────────────────────────

def _merge_results(base: ImovelInput, extra: Optional[ImovelInput]) -> ImovelInput:
    """Preenche campos vazios de `base` com valores de `extra`."""
    if not extra:
        return base
    for field in [
        "titulo", "tipo", "transacao", "descricao",
        "cidade", "bairro", "estado",
        "preco", "area_m2", "quartos", "banheiros", "vagas",
    ]:
        if getattr(base, field) is None and getattr(extra, field) is not None:
            setattr(base, field, getattr(extra, field))
    return base


# ─── Campos para considerar extração "completa" ─────────────────────────────
# LLM é chamada sempre que QUALQUER campo de dados estiver faltando.
# Queremos preencher o máximo possível para cada imóvel.

_ALL_DATA_FIELDS = (
    "preco", "tipo", "transacao", "quartos", "banheiros",
    "vagas", "area_m2", "cidade", "bairro", "descricao",
)


def _missing_fields(result: Optional[ImovelInput]) -> list[str]:
    """Retorna lista de campos de dados que faltam."""
    if result is None:
        return list(_ALL_DATA_FIELDS)
    return [f for f in _ALL_DATA_FIELDS if getattr(result, f) is None]


# ─── Pipeline completa de extração ───────────────────────────────────────────

def extract_property_data(
    html: str,
    url: str,
    fallback_cidade: Optional[str] = None,
    fallback_estado: Optional[str] = None,
    template: Optional['SiteTemplate'] = None,
) -> Optional[ImovelInput]:
    """
    Pipeline completa de extração de um imóvel.

    Com template pronto (após aprender 5 páginas):
    1. Template (CSS selectors) → rápido, sem LLM
    2. Merge com Regex para campos extras
    3. Se template falhar → fallback p/ pipeline completa

    Sem template (ou durante aprendizado):
    1. JSON-LD — dados estruturados (grátis, perfeito)
    2. Regex   — preço, tipo, quartos, área, transação (grátis, universal)
    3. LLM     — preenche campos core faltantes
    4. Ensina template com os dados extraídos

    Retorna None se nada funcionar.
    """
    # Imagens via BS4 (sempre, independente do método)
    imagens = extract_images(html)

    # 404 soft — usar word-boundary para evitar falso positivo em CDN paths (ex: /10404/property/)
    if re.search(r"(?<!\d)404(?!\d)|não encontrad|not found", html[:2000], re.I):
        log.debug(f"✗ 404 soft — {url}")
        return None

    # Detectar página de listagem (não é um imóvel específico)
    soup_quick = BeautifulSoup(html[:3000], "lxml")
    og_title = soup_quick.find("meta", property="og:title")
    quick_title = (og_title.get("content", "") if og_title else "").lower()
    if not quick_title:
        h1 = soup_quick.find("h1")
        quick_title = (h1.get_text(strip=True) if h1 else "").lower()
    if re.search(r"\d+\s*im[óo]veis?\s+para\s+(alugar|comprar|venda)", quick_title):
        log.debug(f"✗ Página de listagem detectada — {url}")
        return None

    # ── FAST PATH: Template pronto → CSS selectors (sem LLM) ──
    if template and template.is_ready:
        tpl_result = template.extract(html, url, fallback_cidade, fallback_estado)
        if tpl_result:
            # Merge com regex para campos que o template não pegou
            regex_extra = extract_quick_regex(html, url)
            if regex_extra:
                # Cross-validação de preço: se divergem muito, logar aviso
                if tpl_result.preco and regex_extra.preco:
                    diff_pct = abs(tpl_result.preco - regex_extra.preco) / max(tpl_result.preco, regex_extra.preco)
                    if diff_pct > 0.15:
                        log.debug(
                            f"  ⚠ Preço diverge: template=R${tpl_result.preco:,.0f} "
                            f"vs regex=R${regex_extra.preco:,.0f} ({diff_pct:.0%})"
                        )
                tpl_result = _merge_results(tpl_result, regex_extra)
            # Se bairro/cidade ainda nulos após CSS+regex, micro-LLM via título
            # (genérico: funciona para qualquer site com localização no título)
            if (tpl_result.bairro is None or tpl_result.cidade is None) and tpl_result.titulo:
                loc = _llm_locate_from_titulo(tpl_result.titulo, url)
                if loc:
                    tpl_result = _merge_results(tpl_result, loc)
            tpl_result.imagens = imagens if imagens else tpl_result.imagens
            preco_str = f"R${tpl_result.preco:,.0f}" if tpl_result.preco else "s/preço"
            log.info(
                f"⚡ [template] {tpl_result.titulo or url[-30:]} — "
                f"{preco_str} ({tpl_result.fields_count} campos)"
            )
            return tpl_result
        # Template falhou nesta URL → fallback para pipeline completa
        log.debug(f"  Template miss → fallback LLM: {url}")

    # ── PIPELINE NORMAL: JSON-LD → Regex → LLM ──
    result: Optional[ImovelInput] = None
    method_parts: list[str] = []

    # ── 1. JSON-LD (melhor cenário — grátis e perfeito) ──
    jsonld_result = extract_from_json_ld(html, url)
    if jsonld_result and (jsonld_result.titulo or jsonld_result.preco):
        result = jsonld_result
        method_parts.append("JSON-LD")

    # ── 2. Regex universal (preço, tipo, quartos, área, transação) ──
    regex_result = extract_quick_regex(html, url)
    if regex_result:
        if result is None:
            result = regex_result
            method_parts.append("Regex")
        else:
            result = _merge_results(result, regex_result)
            if regex_result.preco or regex_result.transacao or regex_result.tipo:
                method_parts.append("+Regex")

    # ── 3. LLM — chamada se campos core faltam ──
    missing = _missing_fields(result)
    # Campos core: sem eles o dado é pouco útil
    core_missing = [f for f in missing if f in ("preco", "tipo", "cidade", "bairro", "transacao")]
    # Durante aprendizado do template: sempre chamar LLM para coleta de dados
    should_call_llm = bool(core_missing) or (template is not None and template.learning)

    if should_call_llm:
        if template:
            template.llm_calls += 1
        log.info(f"  ⚡ {len(missing)} faltando ({', '.join(missing[:5])}) — LLM...")
        llm_result = extract_via_llm(html, url)
        if llm_result:
            if result is None:
                result = llm_result
                method_parts.append("LLM")
            else:
                result = _merge_results(result, llm_result)
                method_parts.append("+LLM")
            still_missing = _missing_fields(result)
            filled = len(missing) - len(still_missing)
            if filled > 0:
                log.info(f"  ✓ LLM preencheu {filled}/{len(missing)} campos")

    if result is None:
        log.warning(f"✗ Nenhum método extraiu dados — {url}")
        return None

    # ── Ensinar template (durante fase de aprendizado) ──
    if template and template.learning:
        template.add_sample(html, result)

    # Fallbacks de localização
    result.cidade = result.cidade or fallback_cidade
    result.estado = result.estado or fallback_estado
    result.imagens = imagens if imagens else result.imagens

    method_str = "".join(method_parts) or "?"
    preco_str = f"R${result.preco:,.0f}" if result.preco else "s/preço"
    trans_str = result.transacao or "?"
    log.info(
        f"✓ Método: {method_str} — {result.titulo or url[:40]} — "
        f"{preco_str} — {trans_str} ({result.fields_count} campos)"
    )
    return result
