---
children_hash: 303f1419777a8d7254d9c8b2122999703b5a916b7fd91d08a2fb4233e8c06233
compression_ratio: 0.6862944162436548
condensation_order: 3
covers: [architecture/_index.md, facts/_index.md]
covers_token_total: 1970
summary_level: d3
token_count: 1352
type: summary
---
# Knowledge Structure Summary

## `architecture`
Project implementation knowledge is currently concentrated in `web_scraping`, which documents benchmark reliability, environment-loading behavior, persistence to Neon/Postgres, and rollout criteria for replacing the legacy extraction pipeline.

### `web_scraping`
This topic centers on benchmark execution around `worker-python/main.py` and related benchmark persistence/instrumentation paths. The topic’s progression is:

1. make local benchmark runs reliable
2. persist benchmark/comparison data
3. add stage-level timing visibility
4. compare legacy vs candidate pipelines
5. block replacement until data quality regressions are resolved

#### Child entry map
- `web_scraping/context.md` — topic framing: shadow-mode execution, env loading, Neon/Postgres fallback, discovery/extraction benchmark evidence, and operational constraints
- `web_scraping/shadow_mode_benchmark_reliability.md` — baseline reliability fixes and first persisted benchmark evidence
- `web_scraping/benchmark_timing_breakdown_and_doppler_run_validation.md` — timing instrumentation, Doppler-safe env behavior, and updated rollout assessment

#### Core architectural decisions
- `worker-python/main.py` is the critical benchmark entrypoint.
- Benchmark persistence must tolerate pooled Neon failures via fallback from `DATABASE_URL` to `DATABASE_URL_UNPOOLED` in `worker-python/app/db.py`.
- Environment loading is execution-mode-sensitive:
  - local CLI runs should load `.env` plus `.env.local`
  - `doppler run` should skip `.env.local` if Doppler env vars are already present
- Benchmark outputs should capture both total elapsed time and named stage timings.
- Replacement decisions must consider extraction correctness regressions, not just speed or LLM reduction.

#### Key preserved benchmark facts
From `shadow_mode_benchmark_reliability.md`:
- Local benchmark execution was fixed by loading `.env.local` in addition to `.env`.
- Verified fonte: `ad023d50-3350-4ad8-b741-2622be26f131` (`Imobiliaria Connect`).
- Initial discovery comparison:
  - candidate: `41` URLs
  - legacy: `40` URLs
  - overlap: `40`
- Initial extraction sample size `5`:
  - candidate: `4 approved / 1 warn / 0 LLM calls`
  - legacy: `5 warn / 5 LLM calls`
- Known risks:
  - malformed Doppler commands in `.env.local` around lines `35–37`
  - invalid `OPENAI_API_KEY`, weakening LLM-fallback evaluation

From `benchmark_timing_breakdown_and_doppler_run_validation.md`:
- Added timing fields:
  - discovery: `discovery_structure_ms`, `discovery_pagination_ms`
  - extraction: `extract_images_ms`, `extract_jsonld_ms`, `extract_regex_ms`, `extract_llm_ms`
  - legacy: `fetch_html_ms`, `validation_ms`, `enrichment_ms`
- Markdown comparison output now includes elapsed totals plus timing breakdowns.
- Doppler runs were validated by preventing `.env.local` overrides when Doppler variables exist.
- Same fonte showed discovery parity:
  - legacy: `1156` URLs
  - candidate: `1156` URLs
- Discovery elapsed:
  - legacy: `699437ms`
  - candidate: `694655ms`
- Discovery bottleneck is pagination work:
  - structure ≈ `40s`
  - pagination ≈ `655s`
- Extraction sample size `10`:
  - legacy: `36782ms`, `10` LLM calls
  - candidate: `3466ms`, `0` LLM calls
  - both: `9 approved / 1 warn`
- Candidate extractor is faster and eliminates LLM usage, but is not rollout-ready due to regressions in fields like `quartos`, `banheiros`, and a suspicious `bairro` mismatch.

#### Cross-entry pattern
`benchmark_timing_breakdown_and_doppler_run_validation.md` directly extends `shadow_mode_benchmark_reliability.md`: reliability first, then instrumentation, then evidence-based replacement evaluation.

---

## `facts`
This domain stores stable repository-wide operational facts rather than feature-specific implementation details.

### `project`
The current topic captures one durable infrastructure fact: curated knowledge for this repository is stored locally in `.brv/context-tree/`.

#### Child entry map
- `project/context.md` — topic framing for repository-local knowledge persistence
- `project/repository_local_context_tree_reset.md` — canonical record of reset-related persistence behavior

#### Key preserved facts
- The authoritative curation write target is `.brv/context-tree/`.
- Knowledge storage is repository-local, not external.
- This persistence fact was explicitly recorded on `2026-03-29`.
- Captured operational flow:
  - `reset -> ByteRover CLI writes -> repository-local .brv context tree persists curated knowledge`

#### Dependencies and boundaries
- Requires a local `.brv/` directory in the repository.
- Curation depends on write access to `.brv/context-tree/`.
- `facts/context.md` defines the domain boundary: durable project/environment/tooling facts belong here; short-lived task planning and feature-specific implementation details do not.

## Cross-domain view
The current knowledge base has two clear layers:
- `architecture` — operational implementation knowledge for the scraping pipeline, especially benchmark reliability and extractor replacement decisions
- `facts` — stable repository-level operational truths, especially local persistence of curated knowledge in `.brv/context-tree/`

Together they show a pattern of keeping durable infrastructure facts in `facts/project` while storing evolving technical benchmark and rollout evidence under `architecture/web_scraping`.