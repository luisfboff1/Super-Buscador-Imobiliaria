---
children_hash: d28492e0106ad3baff5fafa9c1569f05ad76fe08afdb93dbcbb8bbbabe23d5ad
compression_ratio: 0.43133129303749046
condensation_order: 1
covers: [benchmark_timing_breakdown_and_doppler_run_validation.md, buscador_sort_and_extractor_refinements.md, context.md, reset_crawl_flow_per_source.md, shadow_mode_benchmark_reliability.md]
covers_token_total: 5228
summary_level: d1
token_count: 2255
type: summary
---
# web_scraping

## Overview
This topic centers on the web scraping pipeline’s reliability, benchmark instrumentation, search/query integration, extractor evolution, and source reset operations. The entries show a progression from making local/shadow-mode benchmarking reliable, to adding stage-level timing visibility, to refining extraction/search behavior, and finally to adding destructive-but-safe recrawl operations per fonte.

For topic framing, see `context.md`. For benchmark continuity, `benchmark_timing_breakdown_and_doppler_run_validation.md` builds directly on `shadow_mode_benchmark_reliability.md`. Operational source lifecycle behavior is covered separately in `reset_crawl_flow_per_source.md`. Search/extractor product behavior is covered in `buscador_sort_and_extractor_refinements.md`.

## Core Architecture Themes

- **Benchmark reliability and observability**
  - `shadow_mode_benchmark_reliability.md` established local benchmark execution support in:
    - `worker-python/main.py`
    - `worker-python/app/db.py`
    - `.env.local`
  - `benchmark_timing_breakdown_and_doppler_run_validation.md` extended this into **stage-level timing instrumentation** inside `worker-python/main.py` and related benchmark/crawler/extractor modules.
  - Key architectural direction:
    - run benchmarks under a controlled environment
    - persist benchmark runs/comparisons
    - compare **legacy vs candidate** pipelines
    - decide readiness based on **speed + data quality**, not latency alone

- **Extractor pipeline evolution**
  - `buscador_sort_and_extractor_refinements.md` documents the extraction cascade:
    - **JSON-LD -> Regex -> LLM**
  - It also introduces more deterministic extraction through:
    - contextual `area_m2` scoring in `worker-python/app/extractor.py`
    - `SiteTemplate` selector learning with confirmation votes and readiness thresholds
  - This connects to the benchmark entries, where reduced or eliminated LLM calls are a major success criterion.

- **Search/API/database integration**
  - `buscador_sort_and_extractor_refinements.md` spans:
    - `app/(app)/buscador/page.tsx`
    - `app/api/imoveis/route.ts`
    - `lib/db/queries.ts`
  - Architectural pattern:
    - UI state -> authenticated API parsing/validation -> SQL filter/order application -> paginated results
  - Added end-to-end support for:
    - `bairro`
    - `areaMin`
    - `areaMax`
    - `sortBy`

- **Fonte lifecycle control**
  - `reset_crawl_flow_per_source.md` adds a destructive reset path for a fonte:
    - delete all imóveis for a fonte
    - restart crawl
    - reuse existing polling/status infrastructure
  - This creates a clear operational split between:
    - normal sync
    - reset-and-resync

## Entry Relationships

### `shadow_mode_benchmark_reliability.md`
Foundational reliability entry for local/shadow benchmark execution.

- Main decisions:
  - `worker-python/main.py` loads `.env.local` in addition to `.env` for repo-root benchmark CLI execution.
  - `worker-python/app/db.py` falls back from `DATABASE_URL` to `DATABASE_URL_UNPOOLED` when pooled Neon connections fail via `psycopg2`.
- Benchmark evidence captured for fonte `ad023d50-3350-4ad8-b741-2622be26f131` (Imobiliaria Connect).
- Observed early benchmark outcomes:
  - discovery: candidate 41 URLs vs legacy 40, overlap 40
  - extraction sample size 5: candidate 4 approved / 1 warn / 0 LLM calls vs legacy 5 warn / 5 LLM calls
- Environment caveats:
  - malformed Doppler command lines in `.env.local` near lines 35–37
  - invalid `OPENAI_API_KEY` degrades LLM fallback benchmarking

### `benchmark_timing_breakdown_and_doppler_run_validation.md`
Detailed instrumentation and validation follow-up to the shadow-mode reliability work.

- Adds named timing breakdown capture across:
  - discovery structure
  - discovery pagination
  - extraction image stage
  - extraction JSON-LD stage
  - extraction regex stage
  - extraction LLM stage
  - legacy fetch/validation/enrichment
- Reporting enhancements:
  - benchmark models and metrics store `timing_breakdown`
  - Markdown comparison reports now include elapsed totals and breakdowns
- Environment handling changed again:
  - `worker-python/main.py` skips `.env.local` loading when Doppler-related variables are already present, to avoid overriding `doppler run`
- Validated results for the same fonte `ad023d50-3350-4ad8-b741-2622be26f131`:
  - discovery parity: **1156 URLs** for both pipelines
  - elapsed:
    - legacy `699437ms`
    - candidate `694655ms`
  - discovery cost dominated by:
    - ~40s structure work
    - ~655s pagination work
  - extraction sample of 10:
    - legacy `36782ms`, `10` LLM calls
    - candidate `3466ms`, `0` LLM calls
- Readiness conclusion:
  - despite speedups, candidate still regresses on fields like `quartos`, `banheiros`, and shows suspicious `bairro` mismatch
  - candidate is **not yet safe** to replace legacy extraction

### `buscador_sort_and_extractor_refinements.md`
Connects product search behavior with extraction/template-learning refinements.

- Search stack:
  - `app/(app)/buscador/page.tsx`
  - `app/api/imoveis/route.ts`
  - `lib/db/queries.ts`
- Sorting/filtering additions:
  - accepted `sortBy` values:
    - `relevante`
    - `preco_asc`
    - `preco_desc`
    - `area_desc`
    - `recentes`
  - page size fixed at `12`
  - `relevante` and `recentes` currently map to the same backend ordering: `createdAt desc`
- Numeric parsing:
  - API uses Brazilian-number parsing for price and area filters
  - `parseBRNumber` removes thousand separators, converts decimal commas to dots, returns `undefined` if invalid
- Extractor refinements:
  - `_extract_area` uses contextual candidate scoring
  - rejects area values `<= 10` or `> 100_000`
  - favors nearby terms such as área/privativa/construída
  - penalizes condomínio/empreendimento/lazer context
- Preserved regex/pattern decisions:
  - `r\$\s*([\d.,]+)` for price extraction
  - `(\d[\d.,]*)\s*m[²2]` for area candidates
  - `\bno\s+bairro\s+([^,\-\(]+?)\s+em\s` for bairro extraction
- `SiteTemplate` learning:
  - uses early sample pages (`LEARN_PAGES=5`)
  - confirms selectors with votes and semantic validation
  - prevents two confirmed fields from sharing a selector
  - becomes ready only when core data exists (at least one of `titulo` or `preco`) and minimum confirmed fields threshold is met
- LLM detail:
  - extractor fallback model is `gpt-5-nano` with minimal reasoning

### `reset_crawl_flow_per_source.md`
Operational control entry for destructive recrawl per fonte.

- Files:
  - `components/fontes/FonteActions.tsx`
  - `lib/db/queries.ts`
  - `app/api/fontes/[id]/reset-crawl/route.ts`
- Main flow:
  - user clicks **"Apagar e buscar"**
  - UI requests explicit confirmation
  - backend deletes all imóveis for the selected fonte via `deleteImoveisByFonteId`
  - crawl restarts
  - UI polls `/api/fontes/${fonteId}/status`
- Polling/reliability behavior:
  - polling interval: `2500ms`
  - first status read after `1000ms`
  - max crawl window: `60 minutes`
  - stall detection after `2 minutes` without progress unless `heartbeatAt` indicates worker liveness
- UI state model:
  - separate `syncing` and `resetting` flags
  - reset mode changes button label from `"Apagar e buscar"` to `"Limpando..."`
  - on success, preserve final result briefly then clear state and `router.refresh()`
- Important operational rule:
  - reset-crawl is intentionally destructive and gated by explicit confirmation:
    - `"Isso vai apagar todos os imóveis dessa URL e iniciar uma nova busca. Continuar?"`

## Cross-Cutting Patterns

- **Legacy vs candidate benchmarking** is the main validation mechanism for scraper changes.
- **LLM elimination/reduction** is a repeated optimization target, but benchmark results must still preserve field quality.
- **Environment correctness matters**:
  - `.env.local` loading helped local CLI runs
  - Doppler-backed runs later required skipping `.env.local` when Doppler vars are present
- **Discovery remains pagination-bound** according to timing breakdowns; extraction optimizations alone do not address total crawl cost.
- **Search and extraction are converging**:
  - UI/API/query ordering/filter logic and extractor/template learning are being refined together to improve end-user relevance and scrape quality.
- **Operational safety** is handled through explicit confirmation, heartbeat-aware polling, and reuse of existing crawl status infrastructure.

## Drill-Down Guide

- For benchmark setup reliability and Neon fallback behavior:
  - `shadow_mode_benchmark_reliability.md`
- For stage-level timing metrics, Doppler-run validation, and candidate readiness limits:
  - `benchmark_timing_breakdown_and_doppler_run_validation.md`
- For search sorting/filter propagation, Brazilian numeric parsing, area extraction, and `SiteTemplate` learning:
  - `buscador_sort_and_extractor_refinements.md`
- For destructive fonte reset/resync flow and polling safeguards:
  - `reset_crawl_flow_per_source.md`