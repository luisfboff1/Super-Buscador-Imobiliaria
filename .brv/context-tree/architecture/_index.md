---
children_hash: bb8f51c42cb2b446c3950e8746fa6fb6b52c8b7273434037ab2cedb08ad5cce4
compression_ratio: 0.8411881188118812
condensation_order: 2
covers: [context.md, web_scraping/_index.md]
covers_token_total: 2525
summary_level: d2
token_count: 2124
type: summary
---
# architecture / web_scraping

## Scope and purpose
The `architecture` domain captures implementation and operational knowledge for the project’s scraping pipeline. Within it, `web_scraping` focuses on crawler behavior, extraction quality, benchmark workflows, search-query integration, and operational controls for source recrawls. It explicitly excludes unrelated product UI and auth behavior.

Primary drill-down entries:
- `shadow_mode_benchmark_reliability.md`
- `benchmark_timing_breakdown_and_doppler_run_validation.md`
- `buscador_sort_and_extractor_refinements.md`
- `reset_crawl_flow_per_source.md`

## Structural themes

### 1. Benchmark reliability -> observability -> replacement readiness
The benchmark track progresses in two steps:

- `shadow_mode_benchmark_reliability.md` makes local/shadow benchmarking runnable and reliable.
- `benchmark_timing_breakdown_and_doppler_run_validation.md` adds stage-level timing instrumentation and validates benchmark execution under Doppler-aware environments.

This establishes a consistent architectural decision: scraper changes are evaluated by comparing legacy vs candidate pipelines on both speed and extraction quality, not latency alone.

Key files repeatedly involved:
- `worker-python/main.py`
- `worker-python/app/db.py`

## 2. Environment and runtime handling
Two environment decisions shape benchmark execution:

- In `shadow_mode_benchmark_reliability.md`, `worker-python/main.py` loads `.env.local` in addition to `.env` for repo-root benchmark CLI runs.
- In `benchmark_timing_breakdown_and_doppler_run_validation.md`, this behavior is refined so `.env.local` is skipped when Doppler variables are already present, avoiding conflicts with `doppler run`.

Database connectivity was also hardened:
- `worker-python/app/db.py` falls back from `DATABASE_URL` to `DATABASE_URL_UNPOOLED` when pooled Neon connections fail via `psycopg2`.

Operational caveats preserved in the benchmark history:
- malformed Doppler command lines in `.env.local`
- invalid `OPENAI_API_KEY` can degrade LLM-fallback benchmarking

## 3. Benchmark findings and bottlenecks
Across `shadow_mode_benchmark_reliability.md` and `benchmark_timing_breakdown_and_doppler_run_validation.md`, fonte `ad023d50-3350-4ad8-b741-2622be26f131` (Imobiliaria Connect) is the primary validation target.

Observed progression:
- Early benchmark:
  - candidate discovered 41 URLs vs legacy 40, overlap 40
  - extraction sample of 5: candidate 4 approved / 1 warn / 0 LLM calls vs legacy 5 warn / 5 LLM calls
- Later validated benchmark:
  - discovery parity at 1156 URLs for both pipelines
  - total elapsed:
    - legacy: `699437ms`
    - candidate: `694655ms`
  - discovery time is dominated by:
    - ~40s structure work
    - ~655s pagination work
  - extraction sample of 10:
    - legacy: `36782ms`, `10` LLM calls
    - candidate: `3466ms`, `0` LLM calls

Named timing breakdowns were added for:
- discovery structure
- discovery pagination
- extraction image stage
- extraction JSON-LD stage
- extraction regex stage
- extraction LLM stage
- legacy fetch/validation/enrichment

These metrics are persisted in benchmark models/reports through `timing_breakdown`.

Critical architectural conclusion from `benchmark_timing_breakdown_and_doppler_run_validation.md`:
- the candidate pipeline is faster and avoids LLM calls, but is not yet safe to replace legacy extraction because of regressions in fields such as `quartos`, `banheiros`, and suspicious `bairro` mismatches.

## 4. Extraction pipeline evolution
`buscador_sort_and_extractor_refinements.md` documents the extractor direction:

- extraction cascade: JSON-LD -> Regex -> LLM
- optimization goal: reduce or eliminate LLM fallback while preserving field quality

Extractor refinements include:
- `_extract_area` now uses contextual candidate scoring
- rejects area values `<= 10` or `> 100_000`
- boosts contexts near terms like `área`, `privativa`, `construída`
- penalizes contexts like `condomínio`, `empreendimento`, `lazer`

Preserved regex/pattern decisions:
- price: `r\$\s*([\d.,]+)`
- area: `(\d[\d.,]*)\s*m[²2]`
- bairro: `\bno\s+bairro\s+([^,\-\(]+?)\s+em\s`

LLM fallback details:
- model: `gpt-5-nano`
- configured for minimal reasoning

## 5. Template learning and deterministic extraction
`buscador_sort_and_extractor_refinements.md` also introduces `SiteTemplate` learning as a path toward more deterministic extraction.

Key rules:
- learn from early sample pages with `LEARN_PAGES=5`
- selectors are confirmed through votes plus semantic validation
- two confirmed fields cannot share the same selector
- template becomes ready only when:
  - at least one core field exists (`titulo` or `preco`)
  - minimum confirmed field threshold is met

This topic connects directly to benchmark work: better selector learning is intended to lower LLM dependence without sacrificing extraction completeness.

## 6. Search/API/database integration
The same refinement entry ties extraction changes to end-user search behavior across:

- `app/(app)/buscador/page.tsx`
- `app/api/imoveis/route.ts`
- `lib/db/queries.ts`

Architectural flow:
- UI state -> authenticated API parsing/validation -> SQL filter/order application -> paginated results

Added search/filter support includes:
- `bairro`
- `areaMin`
- `areaMax`
- `sortBy`

Accepted `sortBy` values:
- `relevante`
- `preco_asc`
- `preco_desc`
- `area_desc`
- `recentes`

Important current behavior:
- page size is fixed at `12`
- `relevante` and `recentes` currently map to the same backend ordering: `createdAt desc`

Numeric parsing is localized for Brazilian formats:
- `parseBRNumber` removes thousand separators
- converts decimal commas to dots
- returns `undefined` when invalid

## 7. Fonte reset and recrawl operations
`reset_crawl_flow_per_source.md` adds operational lifecycle control for destructive recrawls per fonte.

Main files:
- `components/fontes/FonteActions.tsx`
- `lib/db/queries.ts`
- `app/api/fontes/[id]/reset-crawl/route.ts`

Reset flow:
- user clicks `"Apagar e buscar"`
- UI requires explicit confirmation
- backend deletes all imóveis for the fonte via `deleteImoveisByFonteId`
- crawl restarts
- UI polls `/api/fontes/${fonteId}/status`

Operational safeguards:
- destructive action is intentionally gated by confirmation:
  - `"Isso vai apagar todos os imóveis dessa URL e iniciar uma nova busca. Continuar?"`
- polling interval: `2500ms`
- first status read after `1000ms`
- max crawl window: `60 minutes`
- stall detection after `2 minutes` without progress unless `heartbeatAt` shows worker liveness

UI state model:
- separate `syncing` and `resetting` flags
- reset button label changes to `"Limpando..."`
- success path briefly preserves final result, then clears state and calls `router.refresh()`

## Cross-entry relationships

- `shadow_mode_benchmark_reliability.md` is the foundation for reliable local benchmark execution.
- `benchmark_timing_breakdown_and_doppler_run_validation.md` extends that work with detailed timing metrics and stronger environment handling.
- `buscador_sort_and_extractor_refinements.md` connects extraction quality, selector learning, and product search behavior.
- `reset_crawl_flow_per_source.md` is operationally adjacent: it controls source lifecycle and reuses existing crawl status infrastructure rather than introducing a separate monitoring path.

## Stable architectural patterns
Across the topic, several patterns recur:

- legacy vs candidate benchmarking is the core validation mechanism for scraper changes
- LLM reduction is a deliberate optimization target, but only acceptable if field quality is preserved
- discovery is still pagination-bound, so extraction speedups alone do not solve total crawl cost
- search behavior and extraction logic are evolving together to improve user relevance and scrape accuracy
- destructive operations are allowed only with explicit user confirmation and heartbeat-aware polling safeguards

## Drill-down guide
- For local benchmark execution, `.env.local` loading, and Neon fallback:
  - `shadow_mode_benchmark_reliability.md`
- For timing breakdown instrumentation, Doppler-run handling, and candidate replacement limits:
  - `benchmark_timing_breakdown_and_doppler_run_validation.md`
- For JSON-LD -> Regex -> LLM extraction, `SiteTemplate` learning, and search/filter changes:
  - `buscador_sort_and_extractor_refinements.md`
- For per-fonte delete-and-recrawl flow and UI polling behavior:
  - `reset_crawl_flow_per_source.md`