from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

from app.db import ImovelInput
from app.extractor import (
    _detect_tipo,
    _extract_location_from_url,
    _sanitize_location,
    extract_from_json_ld,
    extract_quick_regex,
)


CRITICAL_FIELDS = ("tipo", "preco", "bairro", "cidade", "area_m2", "imagens")
UF_SIGLAS = {
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
    "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
    "SP", "SE", "TO",
}


def imovel_to_dict(item: Optional[ImovelInput]) -> Optional[dict]:
    if item is None:
        return None
    return {
        "url_anuncio": item.url_anuncio,
        "titulo": item.titulo,
        "tipo": item.tipo,
        "transacao": item.transacao,
        "cidade": item.cidade,
        "bairro": item.bairro,
        "estado": item.estado,
        "preco": item.preco,
        "area_m2": item.area_m2,
        "quartos": item.quartos,
        "banheiros": item.banheiros,
        "vagas": item.vagas,
        "descricao": item.descricao,
        "imagens": item.imagens,
        "caracteristicas": item.caracteristicas,
    }


def classify_image_url(url: str) -> str:
    parsed = urlparse(url)
    path = (parsed.path or "").lower()
    if re.search(r"logo|icon|avatar|favicon|brand|sprite|banner|hero", path):
        return "logo_or_banner"
    if re.search(r"mapa|map|planta|floorplan|croqui", path):
        return "mapa_ou_planta"
    if re.search(r"imovel|property|galeria|gallery|foto|photo|upload|media", path):
        return "likely_property_photo"
    return "unknown"


def summarize_images(images: list[str]) -> dict:
    classes = [classify_image_url(url) for url in images]
    counts: dict[str, int] = {}
    for cls in classes:
        counts[cls] = counts.get(cls, 0) + 1
    likely = counts.get("likely_property_photo", 0)
    noise = counts.get("logo_or_banner", 0) + counts.get("mapa_ou_planta", 0)
    status = "approved" if likely > 0 and likely >= noise else "warn" if images else "rejected"
    reasons = []
    if not images:
        reasons.append("no_images")
    if counts.get("logo_or_banner", 0) > 0:
        reasons.append("contains_logo_or_banner")
    if counts.get("mapa_ou_planta", 0) > 0:
        reasons.append("contains_map_or_floorplan")
    if likely == 0 and images:
        reasons.append("no_likely_property_photo")
    return {
        "status": status,
        "reasons": reasons,
        "counts": counts,
        "images": images,
    }


def infer_field_sources(html: str, url: str, data: Optional[ImovelInput]) -> tuple[dict[str, str], dict[str, float]]:
    if data is None:
        return {}, {}

    jsonld = extract_from_json_ld(html, url)
    regex = extract_quick_regex(html, url)
    url_bairro, url_cidade = _extract_location_from_url(url)
    field_sources: dict[str, str] = {}
    field_confidence: dict[str, float] = {}

    def set_source(field: str, source: str, confidence: float) -> None:
        field_sources[field] = source
        field_confidence[field] = confidence

    for field in ("titulo", "tipo", "transacao", "cidade", "bairro", "preco", "area_m2", "quartos", "banheiros", "vagas"):
        value = getattr(data, field, None)
        if value is None:
            continue

        if field == "bairro" and url_bairro and str(value).lower() == url_bairro.lower():
            set_source(field, "url_slug", 0.92)
            continue
        if field == "cidade" and url_cidade and str(value).lower() == url_cidade.lower():
            set_source(field, "url_slug", 0.92)
            continue
        if field == "tipo":
            detected = _detect_tipo("", url.replace("-", " ").replace("/", " "))
            if detected and detected == value:
                set_source(field, "url_slug", 0.9)
                continue

        if jsonld and getattr(jsonld, field, None) == value:
            set_source(field, "json_ld", 0.88)
            continue
        if regex and getattr(regex, field, None) == value:
            set_source(field, "regex", 0.68)
            continue

        if field in ("bairro", "cidade"):
            set_source(field, "llm_or_template", 0.58)
        elif field in ("preco", "area_m2", "quartos", "banheiros", "vagas"):
            set_source(field, "llm_or_template", 0.55)
        else:
            set_source(field, "legacy_pipeline", 0.5)

    if data.imagens:
        set_source("imagens", "dom_images", 0.6)

    return field_sources, field_confidence


def validate_imovel(data: Optional[ImovelInput], field_sources: dict[str, str]) -> tuple[str, dict[str, list[str]], dict[str, float], dict]:
    if data is None:
        return "rejected", {"item": ["no_data"]}, {}, summarize_images([])

    reasons: dict[str, list[str]] = {}
    adjusted_confidence: dict[str, float] = {}

    def add_reason(field: str, reason: str) -> None:
        reasons.setdefault(field, []).append(reason)

    status_rank = {"approved": 0, "warn": 1, "rejected": 2}
    aggregate_status = "approved"

    def update_status(candidate: str) -> None:
        nonlocal aggregate_status
        if status_rank[candidate] > status_rank[aggregate_status]:
            aggregate_status = candidate

    for field in ("tipo", "preco", "bairro", "cidade", "area_m2"):
        value = getattr(data, field, None)
        base_conf = field_sources.get(field)
        adjusted_confidence[field] = 0.0
        if value is None:
            add_reason(field, "missing")
            update_status("warn")
            continue

        conf = 0.7
        if field == "tipo":
            if _detect_tipo("", str(value)) is None:
                add_reason(field, "unknown_property_type")
                conf = 0.35
                update_status("warn")
        elif field == "preco":
            try:
                preco = float(value)
                if preco <= 1000:
                    add_reason(field, "price_too_low")
                    conf = 0.2
                    update_status("rejected")
                elif preco > 500_000_000:
                    add_reason(field, "price_too_high")
                    conf = 0.2
                    update_status("rejected")
            except (TypeError, ValueError):
                add_reason(field, "invalid_price")
                conf = 0.2
                update_status("rejected")
        elif field == "bairro":
            bairro = _sanitize_location(value)
            if not bairro:
                add_reason(field, "invalid_location")
                conf = 0.2
                update_status("rejected")
            elif _detect_tipo("", str(value)) is not None:
                add_reason(field, "matches_property_type")
                conf = 0.15
                update_status("rejected")
        elif field == "cidade":
            cidade = _sanitize_location(value)
            if not cidade:
                add_reason(field, "invalid_city")
                conf = 0.2
                update_status("rejected")
        elif field == "area_m2":
            try:
                area = float(value)
                if area <= 0:
                    add_reason(field, "non_positive_area")
                    conf = 0.2
                    update_status("rejected")
                elif data.vagas and float(data.vagas) == area and field_sources.get(field) == field_sources.get("vagas"):
                    add_reason(field, "matches_vagas_same_source")
                    conf = 0.25
                    update_status("warn")
                elif area < 10:
                    add_reason(field, "area_suspiciously_low")
                    conf = 0.35
                    update_status("warn")
            except (TypeError, ValueError):
                add_reason(field, "invalid_area")
                conf = 0.2
                update_status("rejected")

        adjusted_confidence[field] = conf

    if data.estado:
        if str(data.estado).upper() not in UF_SIGLAS:
            add_reason("estado", "invalid_state")
            adjusted_confidence["estado"] = 0.2
            update_status("warn")
        else:
            adjusted_confidence["estado"] = 0.8

    images_meta = summarize_images(data.imagens or [])
    if images_meta["status"] == "rejected":
        update_status("rejected")
    elif images_meta["status"] == "warn":
        update_status("warn")
    if images_meta["reasons"]:
        reasons["imagens"] = images_meta["reasons"]
    adjusted_confidence["imagens"] = 0.8 if images_meta["status"] == "approved" else 0.45 if images_meta["status"] == "warn" else 0.1

    return aggregate_status, reasons, adjusted_confidence, images_meta
