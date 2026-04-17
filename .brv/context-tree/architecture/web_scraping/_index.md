---
children_hash: 4c8d73562a1515a5eeccd332353bfca2f098c0d5fd6ba667f97d8619f5ee619d
compression_ratio: 0.5310124049619848
condensation_order: 1
covers: [benchmark_timing_breakdown_and_doppler_run_validation.md, context.md, shadow_mode_benchmark_reliability.md]
covers_token_total: 2499
summary_level: d1
token_count: 1327
type: summary
---
# web_scraping

Structural overview of local shadow-mode benchmark reliability and timing instrumentation for the web scraping pipeline. The topic centers on how `worker-python/main.py` and related benchmark components were adjusted to make benchmark runs reproducible, diagnosable, and comparable across legacy vs candidate extraction paths.

## Topic Scope
From `context.md`:
- Focuses on shadow mode benchmarks, environment loading, Neon connection fallback, and discovery/extraction benchmark evidence.
- Connects operational reliability changes with benchmark outcomes.
- Related to `facts/project` for broader repository facts.

## Key Entries

### `shadow_mode_benchmark_reliability.md`
Primary reliability baseline for local benchmark execution.

- **Entrypoint/environment behavior**
  - `worker-python/main.py` loads `.env.local` in addition to `.env` so the benchmark CLI works from repo root.
  - `worker-python/app/db.py` retries with `DATABASE_URL_UNPOOLED` when pooled Neon connections fail via `psycopg2`.
- **Execution flow**
  - Benchmark CLI start → load `.env`/`.env.local` → connect with `DATABASE_URL` or fallback `DATABASE_URL_UNPOOLED` → create benchmark tables on Neon → run discovery/extraction comparisons → persist run/comparison IDs.
- **Verified benchmark target**
  - Fonte ID: `ad023d50-3350-4ad8-b741-2622be26f131` (Imobiliaria Connect).
- **Observed results**
  - Discovery: candidate found 41 detail URLs vs 40 for legacy, with 40 overlap.
  - Extraction sample size 5: candidate produced 4 approved / 1 warn with `0` LLM calls; legacy produced 5 warn with `5` LLM calls.
- **Environment risks**
  - `.env.local` has malformed Doppler command lines near lines 35–37.
  - Current `OPENAI_API_KEY` is invalid, degrading LLM fallback benchmarking.

Use this entry for the original reliability fixes, Neon fallback behavior, and first persisted benchmark evidence.

### `benchmark_timing_breakdown_and_doppler_run_validation.md`
Follow-up instrumentation and validation entry that deepens benchmark observability and tightens Doppler-run correctness.

- **Instrumentation added**
  - Named timing breakdown storage in benchmark metrics/models.
  - Discovery timing fields: `discovery_structure_ms`, `discovery_pagination_ms`.
  - Extraction timing fields: `extract_images_ms`, `extract_jsonld_ms`, `extract_regex_ms`, `extract_llm_ms`.
  - Legacy runner timing capture: `fetch_html_ms`, `validation_ms`, `enrichment_ms`.
  - Markdown comparison output now includes elapsed totals and timing breakdowns.
- **Environment loading change**
  - `worker-python/main.py` now skips `.env.local` loading when Doppler-related environment variables are already present, preventing local overrides during `doppler run`.
- **Execution flow**
  - Run benchmark under Doppler → capture discovery/extraction stage timings → aggregate per-item timing breakdowns → compare legacy vs candidate → assess speed gains against data regressions.
- **Validated benchmark results for the same fonte**
  - Discovery parity: both pipelines found `1156` URLs.
  - Discovery elapsed:
    - legacy `699437ms`
    - candidate `694655ms`
  - Discovery cost breakdown:
    - structure work ≈ `40s`
    - pagination work ≈ `655s` dominant cost
  - Extraction sample size 10:
    - legacy `36782ms`, `10` LLM calls
    - candidate `3466ms`, `0` LLM calls
    - both produced `9 approved` / `1 warn`
- **Architectural conclusion**
  - Candidate extraction is much faster and avoids LLM usage, but still regresses on fields like `quartos` and `banheiros` and shows a suspicious `bairro` mismatch, so it is **not yet ready** to replace legacy extraction.

Use this entry for stage-level timing architecture, Doppler-specific environment handling, and the updated readiness assessment.

## Cross-Entry Relationships

- `benchmark_timing_breakdown_and_doppler_run_validation.md` explicitly relates to `shadow_mode_benchmark_reliability.md`.
- Together they describe an evolution:
  1. **Reliability enablement**: make local/Neon-backed benchmark execution work consistently.
  2. **Instrumentation expansion**: expose stage-level costs in discovery, extraction, and legacy enrichment.
  3. **Decision support**: use persisted comparisons to evaluate whether the candidate extractor can replace legacy.

## Stable Architectural Decisions

- Benchmarking depends on the Python worker path, especially `worker-python/main.py`.
- Database connectivity for benchmark persistence must tolerate pooled Neon failures via fallback to `DATABASE_URL_UNPOOLED`.
- Environment loading behavior differs by mode:
  - local repo-root CLI runs benefit from `.env.local` loading
  - Doppler-backed runs must avoid `.env.local` overrides when Doppler env vars are present
- Benchmark comparisons should report not only total elapsed time but also stage-level timing breakdowns.
- Candidate extractor evaluation must consider both speed/LLM reduction and field-quality regressions before replacement.

## Current Project Pattern
A consistent pattern emerges across both entries:
- improve benchmark execution reliability
- persist real run/comparison IDs for traceability
- compare candidate vs legacy on discovery and extraction
- reduce LLM dependence where possible
- block rollout until data quality matches or exceeds legacy behavior