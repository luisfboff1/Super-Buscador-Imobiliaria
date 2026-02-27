"""
Extrator de dados de imóveis.

Estratégia em cascata:
1. JSON-LD  — dados estruturados embutidos pela imobiliária (grátis, perfeito)
2. CSS/Meta — extração via seletores CSS e meta tags (grátis, razoável)
3. LLM      — Groq llama-3.1-8b-instant analisa texto limpo e extrai tudo

Cada nível é mais caro/lento que o anterior.
O LLM só é chamado se os anteriores falharem.
"""

import os
import re
import json
from typing import Optional

from bs4 import BeautifulSoup
from groq import Groq

from app.db import ImovelInput
from app.logger import get_logger

log = get_logger("extractor")

# ─── Groq client (lazy init) ─────────────────────────────────────────────────

_groq_client: Optional[Groq] = None


def _get_groq() -> Groq:
    global _groq_client
    if _groq_client is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY não configurada")
        _groq_client = Groq(api_key=api_key)
    return _groq_client


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
                type_match = any(
                    t in item_type
                    for t in ["realestate", "residence", "house", "apartment", "property", "product"]
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


# ─── 3. Extração via CSS / meta tags ─────────────────────────────────────────

def extract_from_css(html: str, url: str) -> Optional[ImovelInput]:
    """
    Extração por heurísticas CSS — tenta seletores comuns de sites imobiliários.
    Menos preciso que JSON-LD, mais barato que LLM.
    """
    soup = BeautifulSoup(html, "lxml")

    # Remove ruído
    for tag in soup.find_all(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()

    text = soup.get_text(" ", strip=True).lower()

    # Título: og:title ou <h1>
    titulo = None
    og_title = soup.find("meta", property="og:title")
    if og_title:
        titulo = og_title.get("content", "").strip()
    if not titulo:
        h1 = soup.find("h1")
        if h1:
            titulo = h1.get_text(strip=True)

    # Preço: regex R$ no texto
    preco = _extract_preco(text)

    # Área: regex m² ou metros
    area = _extract_area(text)

    # Quartos
    quartos = _extract_int_near(text, r"(\d+)\s*(?:quartos?|dorms?|dormit[óo]rios?|suítes?)")

    # Banheiros
    banheiros = _extract_int_near(text, r"(\d+)\s*(?:banheiros?|wc|lavabos?)")

    # Vagas
    vagas = _extract_int_near(text, r"(\d+)\s*(?:vagas?|garagens?)")

    if not titulo and not preco:
        return None

    result = ImovelInput(
        url_anuncio=url,
        titulo=titulo,
        preco=preco,
        area_m2=area,
        quartos=quartos,
        banheiros=banheiros,
        vagas=vagas,
    )

    if result.fields_count >= 2:
        preco_str = f"R${result.preco:,.0f}" if result.preco else "s/preço"
        log.info(f"✓ [css] {result.titulo or 'sem título'} — {preco_str} — {result.fields_count} campos")
        return result

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


def _extract_int_near(text: str, pattern: str) -> Optional[int]:
    """Extrai inteiro de match regex."""
    m = re.search(pattern, text, re.I)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            pass
    return None


# ─── 4. Extração via LLM (Groq) ─────────────────────────────────────────────

SYSTEM_PROMPT = """Você é um extrator de dados de imóveis do mercado imobiliário brasileiro.
Analise o conteúdo da página e extraia os dados do imóvel anunciado.

Regras:
- Retorne APENAS dados explicitamente presentes na página. Não invente valores.
- Se um campo não estiver na página, retorne null.
- Preço deve ser o valor de VENDA (ignorar valores de aluguel/condomínio/IPTU).
- Estado deve ser a sigla com 2 letras (RS, SP, SC, MG, etc).
- Descrição: máximo 500 caracteres, resumindo o texto principal do anúncio.
- transacao: "venda" se está sendo vendido, "aluguel" se está sendo alugado, "ambos" se tiver os dois."""

SCHEMA_GUIDE = """{
  "titulo": "string|null",
  "tipo": "casa|apartamento|terreno|comercial|rural|cobertura|kitnet|sobrado|flat|loft|galpao|sala|loja|outro|null",
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
    "kitnet", "sobrado", "flat", "loft", "galpao", "sala", "loja", "outro",
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
        client = _get_groq()
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
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
            temperature=0,
            max_tokens=1000,
        )

        text = response.choices[0].message.content or ""

        # Extrair JSON da resposta
        json_match = re.search(r"\{[\s\S]*\}", text)
        if not json_match:
            log.warning(f"✗ Sem JSON na resposta LLM — {url}")
            return None

        data = json.loads(json_match.group())

        # Tokens usados
        usage = response.usage
        tokens_in = usage.prompt_tokens if usage else 0
        tokens_out = usage.completion_tokens if usage else 0

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
        log.info(f"✓ [llm] {result.titulo or url[:40]} — {preco_str} — {result.bairro or '?'} (tokens: {tokens_in}→{tokens_out})")
        return result

    except Exception as e:
        log.error(f"✗ LLM falhou para {url}: {e}")
        return None


# ─── Pipeline completa de extração ───────────────────────────────────────────

def extract_property_data(
    html: str,
    url: str,
    fallback_cidade: Optional[str] = None,
    fallback_estado: Optional[str] = None,
) -> Optional[ImovelInput]:
    """
    Pipeline completa de extração de um imóvel.
    
    Cascata: JSON-LD → CSS → LLM
    Retorna None se nada funcionar.
    """
    # Imagens via BS4 (sempre, independente do método)
    imagens = extract_images(html)

    # 404 soft
    if re.search(r"404|não encontrad|not found", html[:2000], re.I):
        log.debug(f"✗ 404 soft — {url}")
        return None

    # ── 1. JSON-LD (melhor cenário — grátis e perfeito) ──
    result = extract_from_json_ld(html, url)
    if result and (result.titulo or result.preco):
        result.cidade = result.cidade or fallback_cidade
        result.estado = result.estado or fallback_estado
        result.imagens = imagens if imagens else result.imagens
        log.info(f"✓ Método: JSON-LD — {result.titulo or url[:40]}")
        return result

    # ── 2. CSS heurístico (grátis, razoável) ──
    result = extract_from_css(html, url)
    if result and result.fields_count >= 3:
        result.cidade = result.cidade or fallback_cidade
        result.estado = result.estado or fallback_estado
        result.imagens = imagens
        log.info(f"✓ Método: CSS — {result.titulo or url[:40]} ({result.fields_count} campos)")
        return result

    # ── 3. LLM via Groq (último recurso) ──
    result = extract_via_llm(html, url)
    if result:
        # Filtrar aluguel
        if result.transacao and "alug" in result.transacao.lower():
            log.info(f"✗ Aluguel ignorado — {url}")
            return None
        result.cidade = result.cidade or fallback_cidade
        result.estado = result.estado or fallback_estado
        result.imagens = imagens
        log.info(f"✓ Método: LLM — {result.titulo or url[:40]}")
        return result

    log.warning(f"✗ Nenhum método extraiu dados — {url}")
    return None
