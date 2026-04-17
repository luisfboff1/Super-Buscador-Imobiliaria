from __future__ import annotations

import json
from collections import Counter

from app.benchmark_models import PipelineRunResult


def _items_by_url(run: PipelineRunResult) -> dict[str, dict]:
    mapped: dict[str, dict] = {}
    for item in run.extraction_items:
        mapped[item.url] = {
            "data": item.data,
            "field_sources": item.field_sources,
            "field_confidence": item.field_confidence,
            "validator_status": item.validator_status,
            "validator_reasons": item.validator_reasons,
            "images_meta": item.images_meta,
            "raw_metrics": item.raw_metrics,
        }
    return mapped


def _imovel_value(data, field: str):
    if data is None:
        return None
    return getattr(data, field, None)


def _compare_discovery(legacy: PipelineRunResult, candidate: PipelineRunResult) -> dict:
    legacy_set = set(legacy.discovery.detail_urls if legacy.discovery else [])
    candidate_set = set(candidate.discovery.detail_urls if candidate.discovery else [])
    overlap = legacy_set & candidate_set
    return {
        "scope": "discovery",
        "legacy": legacy.discovery.__dict__ if legacy.discovery else {},
        "candidate": candidate.discovery.__dict__ if candidate.discovery else {},
        "overlap_count": len(overlap),
        "overlap_ratio": round(len(overlap) / max(len(legacy_set | candidate_set), 1), 3),
        "legacy_only_urls": sorted(list(legacy_set - candidate_set))[:50],
        "candidate_only_urls": sorted(list(candidate_set - legacy_set))[:50],
    }


def _compare_extraction(legacy: PipelineRunResult, candidate: PipelineRunResult) -> dict:
    fields = ("bairro", "cidade", "estado", "tipo", "preco", "area_m2", "quartos", "banheiros", "vagas", "imagens")
    legacy_items = _items_by_url(legacy)
    candidate_items = _items_by_url(candidate)
    all_urls = sorted(set(legacy_items) | set(candidate_items))
    diffs = []
    quality = {
        "legacy": Counter(),
        "candidate": Counter(),
    }

    for url in all_urls:
        l_item = legacy_items.get(url)
        c_item = candidate_items.get(url)
        if l_item:
            quality["legacy"][l_item["validator_status"]] += 1
        if c_item:
            quality["candidate"][c_item["validator_status"]] += 1

        field_diffs = {}
        for field in fields:
            l_val = _imovel_value(l_item["data"], field) if l_item else None
            c_val = _imovel_value(c_item["data"], field) if c_item else None
            if l_val != c_val:
                field_diffs[field] = {
                    "legacy": l_val,
                    "candidate": c_val,
                }

        if field_diffs:
            diffs.append({
                "url": url,
                "field_diffs": field_diffs,
                "legacy_status": l_item["validator_status"] if l_item else "missing",
                "candidate_status": c_item["validator_status"] if c_item else "missing",
            })

    return {
        "scope": "extraction",
        "legacy_counts": dict(quality["legacy"]),
        "candidate_counts": dict(quality["candidate"]),
        "legacy_summary": legacy.summary_metrics.get("extraction", {}),
        "candidate_summary": candidate.summary_metrics.get("extraction", {}),
        "diff_count": len(diffs),
        "top_diffs": diffs[:50],
    }


def _winner(report_json: dict) -> str:
    scope = report_json.get("scope")
    if scope == "discovery":
        legacy = report_json["legacy"].get("detail_count", 0)
        candidate = report_json["candidate"].get("detail_count", 0)
        if candidate > legacy:
            return "candidate wins"
        if legacy > candidate:
            return "legacy wins"
        return "inconclusive"

    if scope == "extraction":
        legacy_good = report_json.get("legacy_counts", {}).get("approved", 0)
        candidate_good = report_json.get("candidate_counts", {}).get("approved", 0)
        if candidate_good > legacy_good:
            return "candidate wins"
        if legacy_good > candidate_good:
            return "legacy wins"
        return "inconclusive"

    return "inconclusive"


def _timing_lines(prefix: str, timings: dict | None) -> list[str]:
    if not timings:
        return []
    lines = [f"- {prefix} timing:"]
    for key, value in sorted(timings.items()):
        lines.append(f"  {key}: `{value}ms`")
    return lines


def _memory_line(prefix: str, memory_peak_mb: float | int | None) -> list[str]:
    if not memory_peak_mb:
        return []
    return [f"- {prefix} peak memory: `{memory_peak_mb}MB`"]


def render_report_markdown(report_json: dict) -> str:
    scope = report_json.get("scope", "full")
    winner = report_json.get("recommendation", _winner(report_json))
    lines = [
        f"# Benchmark {scope}",
        "",
        f"- recommendation: `{winner}`",
    ]

    if scope == "discovery":
        lines.extend([
            f"- legacy detail URLs: `{report_json['legacy'].get('detail_count', 0)}`",
            f"- legacy elapsed: `{report_json['legacy'].get('elapsed_ms', 0)}ms`",
            f"- candidate detail URLs: `{report_json['candidate'].get('detail_count', 0)}`",
            f"- candidate elapsed: `{report_json['candidate'].get('elapsed_ms', 0)}ms`",
            f"- overlap: `{report_json.get('overlap_count', 0)}`",
        ])
        lines.extend(_memory_line("legacy", report_json["legacy"].get("memory_peak_mb")))
        lines.extend(_memory_line("candidate", report_json["candidate"].get("memory_peak_mb")))
        lines.extend(_timing_lines("legacy", report_json["legacy"].get("timing_breakdown")))
        lines.extend(_timing_lines("candidate", report_json["candidate"].get("timing_breakdown")))
        lines.extend([
            "",
            "## URLs exclusivas",
            "",
            f"- legacy only: `{len(report_json.get('legacy_only_urls', []))}`",
            f"- candidate only: `{len(report_json.get('candidate_only_urls', []))}`",
        ])
    elif scope == "extraction":
        legacy_summary = report_json.get("legacy_summary", {})
        candidate_summary = report_json.get("candidate_summary", {})
        lines.extend([
            f"- legacy approved: `{report_json.get('legacy_counts', {}).get('approved', 0)}`",
            f"- legacy elapsed total: `{legacy_summary.get('elapsed_total_ms', 0)}ms`",
            f"- legacy avg item: `{legacy_summary.get('avg_item_elapsed_ms', 0)}ms`",
            f"- candidate approved: `{report_json.get('candidate_counts', {}).get('approved', 0)}`",
            f"- candidate elapsed total: `{candidate_summary.get('elapsed_total_ms', 0)}ms`",
            f"- candidate avg item: `{candidate_summary.get('avg_item_elapsed_ms', 0)}ms`",
            f"- diff urls: `{report_json.get('diff_count', 0)}`",
        ])
        lines.extend(_memory_line("legacy", legacy_summary.get("peak_memory_mb")))
        lines.extend(_memory_line("candidate", candidate_summary.get("peak_memory_mb")))
        lines.extend(_timing_lines("legacy", legacy_summary.get("timing_breakdown")))
        lines.extend(_timing_lines("candidate", candidate_summary.get("timing_breakdown")))
        lines.extend([
            "",
            "## Top diffs",
        ])
        for diff in report_json.get("top_diffs", [])[:10]:
            lines.append(f"- `{diff['url']}`: {json.dumps(diff['field_diffs'], ensure_ascii=False)}")
    else:
        lines.append("Relatório agregado não disponível.")

    return "\n".join(lines) + "\n"


def compare_runs(scope: str, legacy: PipelineRunResult, candidate: PipelineRunResult) -> tuple[dict, str]:
    if scope == "discovery":
        report_json = _compare_discovery(legacy, candidate)
    elif scope == "extraction":
        report_json = _compare_extraction(legacy, candidate)
    else:
        report_json = {
            "scope": "full",
            "discovery": _compare_discovery(legacy, candidate),
            "extraction": _compare_extraction(legacy, candidate),
        }
        report_json["recommendation"] = "split decision"
        markdown = "# Benchmark full\n\n- recommendation: `split decision`\n"
        return report_json, markdown

    report_json["recommendation"] = _winner(report_json)
    return report_json, render_report_markdown(report_json)
