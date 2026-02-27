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
import time
import threading
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


# ─── Rate limiter simples para Groq free tier ────────────────────────────────

class _RateLimiter:
    """
    Garante intervalo mínimo entre chamadas LLM.
    Groq free tier: 30 req/min → 2s entre chamadas evita 429.
    Sem isso, cada 429 causa retry de 12-15s (muito pior).
    """
    def __init__(self, min_interval: float = 2.0):
        self._min_interval = min_interval
        self._last_call = 0.0
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            now = time.time()
            elapsed = now - self._last_call
            if elapsed < self._min_interval:
                wait_time = self._min_interval - elapsed
                log.debug(f"Rate limiter: aguardando {wait_time:.1f}s antes da próxima chamada LLM")
                time.sleep(wait_time)
            self._last_call = time.time()


_groq_limiter = _RateLimiter(min_interval=2.0)


# ─── LLM universal: Groq primary → OpenAI fallback ─────────────────────────────

def _llm_chat(
    messages: list[dict],
    max_tokens: int = 1000,
    temperature: float = 0,
) -> Optional[str]:
    """
    Chama LLM com fallback automático: Groq → OpenAI.
    Retorna o texto da resposta ou None.
    """
    # 1. Tentar Groq (grátis, rápido)
    try:
        client = _get_groq()
        _groq_limiter.wait()
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        text = response.choices[0].message.content or ""
        usage = response.usage
        tokens_in = usage.prompt_tokens if usage else 0
        tokens_out = usage.completion_tokens if usage else 0
        log.debug(f"[groq] OK (tokens: {tokens_in}→{tokens_out})")
        return text
    except Exception as groq_err:
        log.warning(f"[groq] Falhou: {groq_err}")

    # 2. Fallback: OpenAI (pago, sem rate limit agressivo)
    openai_client = _get_openai()
    if openai_client is None:
        log.error("[openai] OPENAI_API_KEY não disponível — sem fallback")
        return None

    try:
        log.info("[openai] Usando GPT-4o-mini como fallback...")
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        text = response.choices[0].message.content or ""
        usage = response.usage
        tokens_in = usage.prompt_tokens if usage else 0
        tokens_out = usage.completion_tokens if usage else 0
        log.info(f"[openai] OK (tokens: {tokens_in}→{tokens_out})")
        return text
    except Exception as openai_err:
        log.error(f"[openai] Também falhou: {openai_err}")
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
                    cidade=address.get("addressLocality"),
                    bairro=address.get("streetAddress") or address.get("addressRegion", "").split(",")[0].strip() or None,
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
        titulo = og_title.get("content", "").strip()
    if not titulo:
        h1 = soup.find("h1")
        if h1:
            titulo = h1.get_text(strip=True)

    # Preço: regex R$ no texto (universal em sites BR)
    preco = _extract_preco(text_lower)

    # Área: regex m² (universal)
    area = _extract_area(text_lower)

    # Transação: detectar da URL ou título (heurística grátis)
    transacao = _detect_transacao(url, titulo or "", text_lower)

    if not titulo and not preco:
        return None

    result = ImovelInput(
        url_anuncio=url,
        titulo=titulo,
        preco=preco,
        area_m2=area,
        transacao=transacao,
    )

    preco_str = f"R${result.preco:,.0f}" if result.preco else "s/preço"
    log.info(f"✓ [regex] {result.titulo or 'sem título'} — {preco_str} — {result.fields_count} campos")
    return result


def _detect_transacao(url: str, titulo: str, text: str) -> Optional[str]:
    """Detecta tipo de transação a partir da URL, título e texto."""
    combined = f"{url.lower()} {titulo.lower()} {text[:500]}"

    has_venda = bool(re.search(r"(comprar|venda|à venda|a venda|para vender)", combined))
    has_aluguel = bool(re.search(r"(alugar|aluguel|locação|para alugar|locacao)", combined))

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
    # Retorna o maior (geralmente é o de venda, não condomínio)
    return max(precos) if precos else None


def _extract_area(text: str) -> Optional[float]:
    """Extrai área em m²."""
    m = re.search(r"([\d.,]+)\s*m[²2]", text)
    if m:
        try:
            return float(m.group(1).replace(".", "").replace(",", "."))
        except ValueError:
            pass
    return None


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
- "bairro": nome do bairro, loteamento ou condomínio. Procure no endereço ou título.
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
            max_tokens=1000,
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
            cidade=data.get("cidade"),
            bairro=data.get("bairro"),
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
    "vagas", "area_m2", "bairro", "descricao",
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
) -> Optional[ImovelInput]:
    """
    Pipeline completa de extração de um imóvel.
    
    1. JSON-LD — dados estruturados (grátis, perfeito)
    2. Regex   — preço R$ e área m² (grátis, universal)
    3. LLM     — preenche TUDO que faltar (qualquer campo vazio aciona a LLM)
    
    Retorna None se nada funcionar.
    """
    # Imagens via BS4 (sempre, independente do método)
    imagens = extract_images(html)

    # 404 soft
    if re.search(r"404|não encontrad|not found", html[:2000], re.I):
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

    result: Optional[ImovelInput] = None
    method_parts: list[str] = []

    # ── 1. JSON-LD (melhor cenário — grátis e perfeito) ──
    jsonld_result = extract_from_json_ld(html, url)
    if jsonld_result and (jsonld_result.titulo or jsonld_result.preco):
        result = jsonld_result
        method_parts.append("JSON-LD")

    # ── 2. Regex universal (preço R$, área m², transação da URL) ──
    regex_result = extract_quick_regex(html, url)
    if regex_result:
        if result is None:
            result = regex_result
            method_parts.append("Regex")
        else:
            result = _merge_results(result, regex_result)
            if regex_result.preco or regex_result.transacao:
                method_parts.append("+Regex")

    # ── 3. LLM — sempre que faltar qualquer campo ──
    missing = _missing_fields(result)
    if missing:
        log.info(f"  ⚡ {len(missing)} campos faltando ({', '.join(missing)}) — chamando LLM...")
        llm_result = extract_via_llm(html, url)
        if llm_result:
            if result is None:
                result = llm_result
                method_parts.append("LLM")
            else:
                result = _merge_results(result, llm_result)
                method_parts.append("+LLM")
            # Log de campos que a LLM preencheu
            still_missing = _missing_fields(result)
            filled = len(missing) - len(still_missing)
            if filled > 0:
                log.info(f"  ✓ LLM preencheu {filled}/{len(missing)} campos")
            if still_missing:
                log.debug(f"  Ainda faltam: {', '.join(still_missing)}")

    if result is None:
        log.warning(f"✗ Nenhum método extraiu dados — {url}")
        return None

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
