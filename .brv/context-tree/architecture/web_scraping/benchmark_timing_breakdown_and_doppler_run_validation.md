---
title: Benchmark Timing Breakdown And Doppler Run Validation
tags: []
related: [architecture/web_scraping/shadow_mode_benchmark_reliability.md]
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-03-31T14:26:47.937Z'
updatedAt: '2026-03-31T14:26:47.937Z'
---
## Raw Concept
**Task:**
Document benchmark timing instrumentation changes and benchmark comparison results for the web scraping pipeline.

**Changes:**
- Added named timing breakdown storage for benchmark metrics and models.
- Recorded discovery_structure_ms and discovery_pagination_ms during discovery.
- Recorded extraction stage timings for images, JSON-LD, regex, and LLM extraction.
- Added legacy fetch, validation, and enrichment timing capture in benchmark runner.
- Extended Markdown comparison reports with elapsed totals and timing breakdowns.
- Updated worker bootstrap so Doppler-backed runs skip .env.local loading.

**Files:**
- worker-python/main.py

**Flow:**
run benchmark under Doppler -> capture stage timings during discovery and extraction -> aggregate per-item timing breakdowns -> compare legacy and candidate runs -> review speed gains versus data regressions

**Timestamp:** 2026-03-31

## Narrative
### Structure
Benchmark reporting now exposes stage-level costs across discovery, extraction, and legacy enrichment paths. The instrumentation spans metrics storage, benchmark models, crawler discovery, extractor stage timing, benchmark runner aggregation, and Markdown comparison output so investigators can see where elapsed time is spent rather than only total durations.

### Dependencies
Local benchmark execution depends on Doppler-backed environment injection, and worker-python/main.py now avoids loading .env.local when Doppler-related environment variables are already present. This prevents local overrides from masking the intended benchmark environment during `doppler run` execution.

### Highlights
Validated comparison data for fonte ad023d50-3350-4ad8-b741-2622be26f131 shows discovery parity at 1156 URLs for both pipelines, with total discovery times of 699437ms for legacy and 694655ms for candidate. Discovery cost is dominated by pagination work at roughly 655 seconds, while discovery structure work is about 40 seconds. In the 10-item extraction sample, the candidate path achieved a major speedup at 3466ms with zero LLM calls versus 36782ms and 10 LLM calls for legacy, but candidate output still regressed on fields such as quartos and banheiros and produced a suspicious bairro mismatch, so it is not yet safe to replace legacy extraction.

### Examples
Discovery run IDs: legacy 88210b3b-e8b4-4111-b6a2-0eead9b86b5d, candidate 25062c52-d12d-4e2c-9f04-d8b696c58840, comparison e324a7f7-17ad-40f6-9c96-393ce0815c2b. Extraction sample run IDs: legacy 5a8f9c9f-cfa9-437c-a8fd-a4f130f8e5f5, candidate d7c92be4-18bb-49f7-b751-c0fc4eeaac22, comparison 0a637770-a92e-4e83-b449-52324097d1e3.

## Facts
- **doppler_env_loading**: worker-python/main.py skips .env.local loading when Doppler-related environment variables are present. [project]
- **benchmark_metrics_timing_breakdowns**: benchmark_metrics.py stores named timing breakdowns. [project]
- **benchmark_models_timing_breakdown**: benchmark_models.py includes timing_breakdown on discovery and extraction items. [project]
- **crawler_discovery_timing**: crawler.py records discovery_structure_ms and discovery_pagination_ms. [project]
- **extractor_stage_timing**: extractor.py records extract_images_ms, extract_jsonld_ms, extract_regex_ms, and extract_llm_ms during extraction. [project]
- **benchmark_runner_stage_timing**: benchmark_runner.py records fetch_html_ms, validation_ms, and enrichment_ms for legacy benchmarks and aggregates per-item timing breakdowns in extraction summaries. [project]
- **benchmark_compare_reporting**: benchmark_compare.py includes elapsed totals and timing breakdowns in Markdown reports. [project]
- **benchmark_discovery_url_count**: For fonte ad023d50-3350-4ad8-b741-2622be26f131, both legacy and candidate discovery runs found 1156 URLs. [project]
- **benchmark_discovery_elapsed**: For the same fonte, legacy discovery took 699437ms and candidate discovery took 694655ms. [project]
- **discovery_stage_costs**: Discovery time was dominated by about 40 seconds in discovery_structure and about 655 seconds in discovery_pagination. [project]
- **benchmark_extraction_quality_summary**: In the extraction sample of 10 items, both legacy and candidate produced 9 approved and 1 warn. [project]
- **benchmark_extraction_elapsed_and_llm**: Legacy extraction took 36782ms with 10 LLM calls, while candidate extraction took 3466ms with 0 LLM calls. [project]
- **candidate_extractor_readiness**: The candidate extractor still has regressions in fields such as quartos and banheiros and a suspicious bairro mismatch, so it is not ready to replace the legacy extractor. [project]
