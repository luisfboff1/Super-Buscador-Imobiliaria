---
children_hash: 466cb5a0fd5892e8c3a61443a721f03df22e81ed801e9ddacb5ef453981bb200
compression_ratio: 0.8669201520912547
condensation_order: 2
covers: [context.md, web_scraping/_index.md]
covers_token_total: 1578
summary_level: d2
token_count: 1368
type: summary
---
# architecture

Implementation and operational knowledge for the project’s web scraping pipeline, focused on crawler/extractor behavior, shadow-mode benchmarks, scraping reliability fixes, and benchmark-driven replacement decisions. This domain excludes unrelated UI and auth concerns and is owned by scraping/ingestion implementation.

## Topic structure

### `web_scraping`
Technical benchmark and reliability topic centered on `worker-python/main.py` and related benchmark persistence/instrumentation paths. It documents how local and Doppler-backed benchmark runs were made reproducible, diagnosable, and suitable for comparing legacy vs candidate extraction pipelines.

## Key child entries

### `web_scraping/context.md`
Defines topic scope around:
- shadow-mode benchmark execution
- environment loading behavior
- Neon/Postgres connection fallback
- discovery/extraction benchmark evidence
- operational constraints that affect reliable scraping evaluation

### `web_scraping/shadow_mode_benchmark_reliability.md`
Baseline reliability entry for getting local benchmark runs working correctly.

Preserved facts:
- `worker-python/main.py` loads `.env.local` in addition to `.env` for repo-root benchmark CLI execution.
- `worker-python/app/db.py` falls back to `DATABASE_URL_UNPOOLED` when pooled Neon connections fail through `psycopg2`.
- Execution flow:
  - benchmark CLI start
  - load `.env` / `.env.local`
  - connect with `DATABASE_URL` or fallback `DATABASE_URL_UNPOOLED`
  - create benchmark tables on Neon
  - run discovery/extraction comparisons
  - persist run/comparison IDs
- Verified fonte target:
  - `ad023d50-3350-4ad8-b741-2622be26f131` (`Imobiliaria Connect`)
- Initial observed benchmark evidence:
  - discovery: candidate `41` URLs vs legacy `40`, with `40` overlap
  - extraction sample size `5`: candidate `4 approved / 1 warn / 0 LLM calls`; legacy `5 warn / 5 LLM calls`
- Known environment risks:
  - malformed Doppler command lines in `.env.local` near lines `35–37`
  - invalid `OPENAI_API_KEY`, which weakens LLM-fallback benchmarking

Use this entry for the original local reliability fixes and first persisted benchmark evidence.

### `web_scraping/benchmark_timing_breakdown_and_doppler_run_validation.md`
Follow-up entry adding timing instrumentation and correcting Doppler-run environment behavior.

Preserved facts:
- Added named timing breakdown fields in benchmark metrics/models:
  - discovery: `discovery_structure_ms`, `discovery_pagination_ms`
  - extraction: `extract_images_ms`, `extract_jsonld_ms`, `extract_regex_ms`, `extract_llm_ms`
  - legacy runner: `fetch_html_ms`, `validation_ms`, `enrichment_ms`
- Markdown comparison output now includes elapsed totals plus timing breakdowns.
- `worker-python/main.py` skips `.env.local` loading when Doppler-related environment variables are already present, preventing bad local overrides during `doppler run`.
- Execution flow:
  - run benchmark under Doppler
  - capture discovery/extraction stage timings
  - aggregate per-item timing breakdowns
  - compare legacy vs candidate
  - judge speed gains against data regressions
- Validated results for the same fonte:
  - discovery parity: both pipelines found `1156` URLs
  - discovery elapsed:
    - legacy `699437ms`
    - candidate `694655ms`
  - discovery cost concentration:
    - structure work ≈ `40s`
    - pagination work ≈ `655s` and is the dominant cost
  - extraction sample size `10`:
    - legacy `36782ms`, `10` LLM calls
    - candidate `3466ms`, `0` LLM calls
    - both `9 approved / 1 warn`
- Readiness decision:
  - candidate extraction is much faster and removes LLM usage
  - it still regresses on fields such as `quartos` and `banheiros`
  - there is also a suspicious `bairro` mismatch
  - therefore candidate extraction is not yet ready to replace legacy

Use this entry for stage-level timing architecture, Doppler-safe environment handling, and the updated rollout assessment.

## Cross-entry relationships

- `benchmark_timing_breakdown_and_doppler_run_validation.md` builds directly on `shadow_mode_benchmark_reliability.md`.
- The topic progression is:
  1. make benchmark execution reliable locally and against Neon
  2. add granular timing instrumentation for discovery/extraction/legacy stages
  3. use persisted comparisons to evaluate candidate-vs-legacy replacement readiness

## Stable architectural decisions

- Benchmarking depends heavily on the Python worker entrypoint, especially `worker-python/main.py`.
- Benchmark persistence must tolerate pooled Neon failures via fallback to `DATABASE_URL_UNPOOLED`.
- Environment loading is mode-sensitive:
  - local CLI execution benefits from `.env.local`
  - `doppler run` must avoid `.env.local` overrides when Doppler variables exist
- Benchmark reports should include both total elapsed time and stage-level timing breakdowns.
- Replacement decisions for the candidate extractor must weigh speed and LLM reduction against field-quality regressions, not speed alone.

## Recurring project pattern

Across `shadow_mode_benchmark_reliability.md` and `benchmark_timing_breakdown_and_doppler_run_validation.md`, the web scraping architecture follows a consistent evaluation loop:
- improve benchmark execution reliability
- persist traceable run/comparison data
- compare candidate and legacy in both discovery and extraction
- reduce LLM dependence where possible
- block rollout until extraction quality matches or exceeds legacy behavior