from __future__ import annotations

import json
import time
from collections import Counter
from typing import Callable, Optional
from urllib.parse import urlparse

from app.benchmark_compare import compare_runs
from app.benchmark_metrics import metrics_scope, record_strategy, timed_step
from app.benchmark_models import (
    BenchmarkStage,
    DiscoveryResult,
    ExtractionItemResult,
    PipelineMode,
    PipelineRunResult,
)
from app.benchmark_validator import infer_field_sources, imovel_to_dict, validate_imovel
from app.crawler import (
    configure_runtime_tuning,
    discover_property_urls,
    extract_detail_links,
    fetch_page,
    fetch_property_html,
    get_runtime_tuning,
    scrape_property_page,
)
from app.db import (
    ImovelInput,
    create_crawl_run,
    create_crawl_run_comparison,
    ensure_benchmark_tables,
    fail_crawl_run,
    finalize_crawl_run,
    get_existing_imovel_urls_list,
    get_fonte_by_id,
    insert_crawl_run_items,
)
from app.extractor import (
    _detect_tipo,
    _extract_location_from_url,
    _merge_results,
    _missing_fields,
    extract_from_json_ld,
    extract_images,
    extract_quick_regex,
    extract_via_llm,
)
from app.logger import get_logger

log = get_logger("benchmark")


def _snapshot_config(config: Optional[dict]) -> dict:
    return json.loads(json.dumps(config or {}, ensure_ascii=False))


def _aggregate_timing_breakdowns(items: list[ExtractionItemResult]) -> dict[str, int]:
    aggregated: Counter[str] = Counter()
    for item in items:
        aggregated.update(item.timing_breakdown or {})
    return dict(aggregated)


def _emit_progress(progress: Optional[Callable[[str], None]], message: str) -> None:
    if progress:
        progress(message)
    else:
        log.info(message)


def _candidate_discovery(
    site_url: str,
    site_config: Optional[dict],
    progress: Optional[Callable[[str], None]] = None,
) -> DiscoveryResult:
    started = time.time()
    config = site_config or {}
    profile = config.get("site_profile") or {}
    listing_urls = profile.get("listing_urls") or config.get("listing_urls") or []

    with metrics_scope() as metrics:
        record_strategy("candidate_discovery")
        _emit_progress(progress, f"[candidate][discovery] iniciando {site_url}")
        detail_urls: set[str] = set()
        strategy_used = "site_profile"

        if listing_urls:
            hostname = urlparse(site_url).hostname or ""
            use_stealth = bool(profile.get("requires_js") or profile.get("requires_stealth"))
            for listing_url in listing_urls:
                _emit_progress(progress, f"[candidate][discovery] listagem {listing_url} | stealth={use_stealth}")
                page = fetch_page(listing_url, stealth=use_stealth)
                if not page:
                    continue
                detail_urls.update(extract_detail_links(page, hostname))
        else:
            strategy_used = "legacy_fallback"
            detail_urls = set(discover_property_urls(site_url, on_progress=progress, site_config=site_config))
            listing_urls = []

        elapsed_ms = int((time.time() - started) * 1000)
        _emit_progress(progress, f"[candidate][discovery] concluído | detail_urls={len(detail_urls)} | elapsed={elapsed_ms}ms")
        return DiscoveryResult(
            listing_urls=list(listing_urls),
            detail_urls=sorted(detail_urls),
            listing_count=len(listing_urls),
            detail_count=len(detail_urls),
            http_calls=metrics.http_calls,
            browser_calls=metrics.browser_calls,
            llm_calls=metrics.llm_calls,
            elapsed_ms=elapsed_ms,
            strategy_used=strategy_used,
            timing_breakdown=dict(metrics.timings),
            memory_peak_mb=metrics.peak_memory_mb,
        )


def _legacy_discovery(
    site_url: str,
    site_config: Optional[dict],
    progress: Optional[Callable[[str], None]] = None,
) -> DiscoveryResult:
    started = time.time()
    with metrics_scope() as metrics:
        _emit_progress(progress, f"[legacy][discovery] iniciando {site_url}")
        detail_urls = discover_property_urls(site_url, on_progress=progress, site_config=site_config)
        elapsed_ms = int((time.time() - started) * 1000)
        listing_urls = list((site_config or {}).get("listing_urls", []))
        _emit_progress(progress, f"[legacy][discovery] concluído | detail_urls={len(detail_urls)} | elapsed={elapsed_ms}ms")
        return DiscoveryResult(
            listing_urls=listing_urls,
            detail_urls=detail_urls,
            listing_count=len(listing_urls),
            detail_count=len(detail_urls),
            http_calls=metrics.http_calls,
            browser_calls=metrics.browser_calls,
            llm_calls=metrics.llm_calls,
            elapsed_ms=elapsed_ms,
            strategy_used="legacy_discovery",
            timing_breakdown=dict(metrics.timings),
            memory_peak_mb=metrics.peak_memory_mb,
        )


def _candidate_extract_item(
    url: str,
    fallback_cidade: Optional[str],
    fallback_estado: Optional[str],
    progress: Optional[Callable[[str], None]] = None,
) -> ExtractionItemResult:
    started = time.time()
    with metrics_scope() as metrics:
        record_strategy("candidate_extraction")
        _emit_progress(progress, f"[candidate][extract] {url}")
        with timed_step("fetch_html_ms"):
            html, source = fetch_property_html(url)
        if not html:
            return ExtractionItemResult(
                url=url,
                data=None,
                validator_status="rejected",
                validator_reasons={"item": ["fetch_failed"]},
                elapsed_ms=int((time.time() - started) * 1000),
                http_calls=metrics.http_calls,
                browser_calls=metrics.browser_calls,
                llm_calls=metrics.llm_calls,
                timing_breakdown=dict(metrics.timings),
                memory_peak_mb=metrics.peak_memory_mb,
                raw_metrics={"source": source, **metrics.to_dict()},
            )

        with timed_step("extract_jsonld_ms"):
            result = extract_from_json_ld(html, url)
        with timed_step("extract_regex_ms"):
            regex_result = extract_quick_regex(html, url)
        if result is None:
            result = regex_result
        else:
            result = _merge_results(result, regex_result)

        if result is None:
            result = ImovelInput(url_anuncio=url)

        url_bairro, url_cidade = _extract_location_from_url(url)
        if not result.bairro and url_bairro:
            result.bairro = url_bairro
        if not result.cidade and url_cidade:
            result.cidade = url_cidade
        if not result.tipo:
            url_tipo = _detect_tipo("", url.replace("-", " ").replace("/", " "))
            if url_tipo:
                result.tipo = url_tipo
        if not result.cidade and fallback_cidade:
            result.cidade = fallback_cidade
        if not result.estado and fallback_estado:
            result.estado = fallback_estado

        core_missing = [f for f in _missing_fields(result) if f in ("preco", "tipo", "cidade", "bairro", "transacao")]
        if core_missing:
            with timed_step("extract_llm_ms"):
                llm_result = extract_via_llm(html, url)
            result = _merge_results(result, llm_result)

        with timed_step("extract_images_ms"):
            result.imagens = extract_images(html)

        with timed_step("validation_ms"):
            field_sources, field_confidence = infer_field_sources(html, url, result)
            validator_status, validator_reasons, validated_confidence, images_meta = validate_imovel(result, field_sources)
        for field, conf in validated_confidence.items():
            field_confidence[field] = min(field_confidence.get(field, conf), conf)

        return ExtractionItemResult(
            url=url,
            data=result,
            field_sources=field_sources,
            field_confidence=field_confidence,
            validator_status=validator_status,
            validator_reasons=validator_reasons,
            images_meta=images_meta,
            http_calls=metrics.http_calls,
            browser_calls=metrics.browser_calls,
            llm_calls=metrics.llm_calls,
            elapsed_ms=int((time.time() - started) * 1000),
            timing_breakdown=dict(metrics.timings),
            memory_peak_mb=metrics.peak_memory_mb,
            raw_metrics={"source": source, **metrics.to_dict()},
        )


def _legacy_extract_item(
    url: str,
    fallback_cidade: Optional[str],
    fallback_estado: Optional[str],
    progress: Optional[Callable[[str], None]] = None,
) -> ExtractionItemResult:
    started = time.time()
    with metrics_scope() as metrics:
        record_strategy("legacy_extraction")
        _emit_progress(progress, f"[legacy][extract] {url}")
        with timed_step("fetch_html_ms"):
            html, source = fetch_property_html(url)
        if not html:
            return ExtractionItemResult(
                url=url,
                data=None,
                validator_status="rejected",
                validator_reasons={"item": ["fetch_failed"]},
                elapsed_ms=int((time.time() - started) * 1000),
                http_calls=metrics.http_calls,
                browser_calls=metrics.browser_calls,
                llm_calls=metrics.llm_calls,
                timing_breakdown=dict(metrics.timings),
                memory_peak_mb=metrics.peak_memory_mb,
                raw_metrics={"source": source, **metrics.to_dict()},
            )

        with timed_step("enrichment_ms"):
            result = scrape_property_page(url, fallback_cidade, fallback_estado, template=None)
        with timed_step("validation_ms"):
            field_sources, field_confidence = infer_field_sources(html, url, result)
            validator_status, validator_reasons, validated_confidence, images_meta = validate_imovel(result, field_sources)
        for field, conf in validated_confidence.items():
            field_confidence[field] = min(field_confidence.get(field, conf), conf)

        return ExtractionItemResult(
            url=url,
            data=result,
            field_sources=field_sources,
            field_confidence=field_confidence,
            validator_status=validator_status,
            validator_reasons=validator_reasons,
            images_meta=images_meta,
            http_calls=metrics.http_calls,
            browser_calls=metrics.browser_calls,
            llm_calls=metrics.llm_calls,
            elapsed_ms=int((time.time() - started) * 1000),
            timing_breakdown=dict(metrics.timings),
            memory_peak_mb=metrics.peak_memory_mb,
            raw_metrics={"source": source, **metrics.to_dict()},
        )


def _summary_from_items(items: list[ExtractionItemResult]) -> dict:
    counts = Counter(item.validator_status for item in items)
    llm_calls = sum(item.llm_calls for item in items)
    browser_calls = sum(item.browser_calls for item in items)
    http_calls = sum(item.http_calls for item in items)
    elapsed_total_ms = sum(item.elapsed_ms for item in items)
    return {
        "items": len(items),
        "approved": counts.get("approved", 0),
        "warn": counts.get("warn", 0),
        "rejected": counts.get("rejected", 0),
        "llm_calls": llm_calls,
        "browser_calls": browser_calls,
        "http_calls": http_calls,
        "elapsed_total_ms": elapsed_total_ms,
        "avg_item_elapsed_ms": int(elapsed_total_ms / len(items)) if items else 0,
        "timing_breakdown": _aggregate_timing_breakdowns(items),
        "peak_memory_mb": max((item.memory_peak_mb for item in items), default=0.0),
    }


def _persist_run(fonte_id: str, run: PipelineRunResult, trigger_mode: str, config_snapshot: dict, site_profile_snapshot: dict) -> str:
    run_id = create_crawl_run(
        fonte_id=fonte_id,
        pipeline_version=run.pipeline_version,
        stage=run.stage,
        trigger_mode=trigger_mode,
        status="running",
        config_snapshot=config_snapshot,
        site_profile_snapshot=site_profile_snapshot,
    )
    items_payload = []
    if run.discovery:
        for url in run.discovery.detail_urls:
            items_payload.append({
                "url": url,
                "item_type": "detail",
                "discovered": True,
                "raw_metrics": {"scope": "discovery"},
            })
    for item in run.extraction_items:
        items_payload.append({
            "url": item.url,
            "item_type": "detail",
            "discovered": False,
            "extracted_data": imovel_to_dict(item.data),
            "field_sources": item.field_sources,
            "field_confidence": item.field_confidence,
            "validator_status": item.validator_status,
            "validator_reasons": item.validator_reasons,
            "images_meta": item.images_meta,
            "raw_metrics": {
                "http_calls": item.http_calls,
                "browser_calls": item.browser_calls,
                "llm_calls": item.llm_calls,
                "elapsed_ms": item.elapsed_ms,
                **item.raw_metrics,
            },
        })
    insert_crawl_run_items(run_id, items_payload)
    finalize_crawl_run(run_id, "ok", run.elapsed_ms, run.summary_metrics)
    return run_id


def _resolve_extraction_urls(
    fonte_id: str,
    site_url: str,
    site_config: Optional[dict],
    sample_size: int,
    use_existing_detail_urls: bool,
) -> list[str]:
    urls = get_existing_imovel_urls_list(fonte_id) if use_existing_detail_urls else []
    if not urls:
        urls = discover_property_urls(site_url, site_config=site_config)
    urls = list(dict.fromkeys(urls))
    if sample_size > 0:
        urls = urls[:sample_size]
    return urls


def _run_single_pipeline(
    pipeline_version: str,
    stage: BenchmarkStage,
    fonte_id: str,
    site_url: str,
    site_config: Optional[dict],
    fallback_cidade: Optional[str],
    fallback_estado: Optional[str],
    sample_size: int,
    use_existing_detail_urls: bool,
    progress: Optional[Callable[[str], None]] = None,
) -> PipelineRunResult:
    started = time.time()
    run = PipelineRunResult(pipeline_version=pipeline_version, stage=stage)

    if stage in ("discovery", "full"):
        discovery_fn = _legacy_discovery if pipeline_version == "legacy" else _candidate_discovery
        run.discovery = discovery_fn(site_url, site_config, progress=progress)

    if stage in ("extraction", "full"):
        urls = (
            _resolve_extraction_urls(fonte_id, site_url, site_config, sample_size, use_existing_detail_urls)
            if stage == "extraction"
            else (run.discovery.detail_urls[:sample_size] if sample_size > 0 else run.discovery.detail_urls)
        )
        extractor_fn = _legacy_extract_item if pipeline_version == "legacy" else _candidate_extract_item
        run.extraction_items = [extractor_fn(url, fallback_cidade, fallback_estado, progress=progress) for url in urls]

    run.elapsed_ms = int((time.time() - started) * 1000)
    run.summary_metrics = {
        "elapsed_ms": run.elapsed_ms,
        "runtime_tuning": get_runtime_tuning(),
        "discovery": run.discovery.__dict__ if run.discovery else None,
        "extraction": _summary_from_items(run.extraction_items) if run.extraction_items else None,
    }
    return run


def run_benchmark(
    fonte_id: str,
    pipeline_mode: PipelineMode,
    stage: BenchmarkStage,
    sample_size: int = 0,
    use_existing_detail_urls: bool = False,
    persist_report: bool = False,
    trigger_mode: str = "cli",
    max_pages: Optional[int] = None,
    pagination_http_batch_size: Optional[int] = None,
    pagination_stealth_batch_size: Optional[int] = None,
    max_stealth_concurrent: Optional[int] = None,
    stream_progress: bool = False,
) -> dict:
    ensure_benchmark_tables()
    fonte = get_fonte_by_id(fonte_id)
    if not fonte:
        raise ValueError(f"Fonte não encontrada: {fonte_id}")

    config_snapshot = _snapshot_config(fonte.config)
    site_profile_snapshot = _snapshot_config((fonte.config or {}).get("site_profile") or {})
    runs: dict[str, PipelineRunResult] = {}
    run_ids: dict[str, Optional[str]] = {"legacy": None, "candidate": None}
    tuning_snapshot = configure_runtime_tuning(
        max_pages=max_pages,
        pagination_http_batch_size=pagination_http_batch_size,
        pagination_stealth_batch_size=pagination_stealth_batch_size,
        max_stealth_concurrent=max_stealth_concurrent,
    )
    active_tuning = get_runtime_tuning()
    progress = (lambda message: print(message, flush=True)) if stream_progress else None

    requested = ["legacy", "candidate"] if pipeline_mode == "both" else [pipeline_mode]
    try:
        _emit_progress(progress, f"[benchmark] fonte={fonte.id} stage={stage} pipeline={pipeline_mode}")
        _emit_progress(progress, f"[benchmark] tuning={json.dumps(active_tuning, ensure_ascii=False)}")
        for pipeline_version in requested:
            try:
                run = _run_single_pipeline(
                    pipeline_version=pipeline_version,
                    stage=stage,
                    fonte_id=fonte.id,
                    site_url=fonte.url,
                    site_config=fonte.config,
                    fallback_cidade=fonte.cidade,
                    fallback_estado=fonte.estado,
                    sample_size=sample_size,
                    use_existing_detail_urls=use_existing_detail_urls,
                    progress=progress,
                )
                runs[pipeline_version] = run
                if persist_report:
                    run_ids[pipeline_version] = _persist_run(
                        fonte_id=fonte.id,
                        run=run,
                        trigger_mode=trigger_mode,
                        config_snapshot=config_snapshot,
                        site_profile_snapshot=site_profile_snapshot,
                    )
            except Exception as err:
                if run_ids.get(pipeline_version):
                    fail_crawl_run(run_ids[pipeline_version], str(err))
                raise
    finally:
        configure_runtime_tuning(**tuning_snapshot)

    comparison_json = None
    comparison_markdown = None
    comparison_id = None
    if "legacy" in runs and "candidate" in runs:
        comparison_scope = "full" if stage == "full" else stage
        comparison_json, comparison_markdown = compare_runs(comparison_scope, runs["legacy"], runs["candidate"])
        if persist_report:
            comparison_id = create_crawl_run_comparison(
                run_ids.get("legacy"),
                run_ids.get("candidate"),
                comparison_scope,
                comparison_json,
                comparison_markdown,
            )

    return {
        "fonte": {
            "id": fonte.id,
            "nome": fonte.nome,
            "url": fonte.url,
        },
        "stage": stage,
        "pipeline_mode": pipeline_mode,
        "runtime_tuning": active_tuning,
        "runs": {
            key: {
                "run_id": run_ids.get(key),
                "summary_metrics": run.summary_metrics,
            }
            for key, run in runs.items()
        },
        "comparison_id": comparison_id,
        "comparison_json": comparison_json,
        "comparison_markdown": comparison_markdown,
    }
