---
children_hash: bb7ee56a79006dd33552ebf2a183647e333c4bf68c42e99dcce6af41da817e83
compression_ratio: 0.784400544959128
condensation_order: 3
covers: [architecture/_index.md, facts/_index.md]
covers_token_total: 2936
summary_level: d3
token_count: 2303
type: summary
---
# Knowledge Structure Summary

## Domains
- `architecture`: implementation and operational knowledge for the scraping system, centered on `web_scraping`
- `facts`: durable repository-wide operational facts and baseline behaviors, centered on `project`

---

## `architecture` domain

### Main topic: `web_scraping`
This topic captures how the scraping pipeline is validated, optimized, integrated with search, and operated in production-like workflows. It links benchmark methodology, extraction design, runtime environment handling, search/API/database behavior, and per-fonte recrawl controls.

Primary drill-down:
- `shadow_mode_benchmark_reliability.md`
- `benchmark_timing_breakdown_and_doppler_run_validation.md`
- `buscador_sort_and_extractor_refinements.md`
- `reset_crawl_flow_per_source.md`

### Core architectural patterns
- Scraper changes are validated through **legacy vs candidate benchmarking**, not by speed alone.
- **LLM fallback reduction** is a major design goal, but only if extraction quality remains acceptable.
- Total crawl cost is still strongly constrained by **pagination-heavy discovery**, so extraction gains do not fully solve runtime.
- Search behavior and extraction logic are evolving together across UI, API, and SQL layers.
- Destructive operational actions require **explicit confirmation** and **heartbeat-aware polling safeguards**.

### Benchmarking and runtime reliability
From `shadow_mode_benchmark_reliability.md` and `benchmark_timing_breakdown_and_doppler_run_validation.md`:

Key files:
- `worker-python/main.py`
- `worker-python/app/db.py`

Key decisions:
- `worker-python/main.py` supports repo-root benchmark execution by loading `.env.local` alongside `.env`.
- When running under Doppler, `.env.local` is skipped if Doppler variables are already present to avoid conflicts.
- `worker-python/app/db.py` falls back from `DATABASE_URL` to `DATABASE_URL_UNPOOLED` when pooled Neon connections fail via `psycopg2`.

Operational caveats preserved in benchmark history:
- malformed Doppler command lines in `.env.local`
- invalid `OPENAI_API_KEY` can impair LLM-fallback benchmarking

### Benchmark findings and replacement boundary
Validation focused on fonte `ad023d50-3350-4ad8-b741-2622be26f131` (Imobiliaria Connect).

Progression:
- Early run: candidate found `41` URLs vs legacy `40`, with overlap `40`
- Early extraction sample (`5` pages):
  - candidate: `4 approved / 1 warn / 0 LLM calls`
  - legacy: `5 warn / 5 LLM calls`
- Later validated run: both pipelines reached `1156` discovered URLs
- Total elapsed:
  - legacy: `699437ms`
  - candidate: `694655ms`

Instrumented timing buckets include:
- discovery structure
- discovery pagination
- extraction image
- extraction JSON-LD
- extraction regex
- extraction LLM
- legacy fetch / validation / enrichment

Major bottleneck:
- discovery remained dominated by roughly `~40s` structure work and `~655s` pagination work

Extraction sample (`10` pages):
- legacy: `36782ms`, `10` LLM calls
- candidate: `3466ms`, `0` LLM calls

Critical conclusion from `benchmark_timing_breakdown_and_doppler_run_validation.md`:
- the candidate pipeline is materially faster and avoids LLM calls
- it is **not yet safe to replace** legacy extraction because of regressions in fields like `quartos`, `banheiros`, and suspicious `bairro` mismatches

### Extraction pipeline and deterministic learning
From `buscador_sort_and_extractor_refinements.md`:

Extraction cascade:
- `JSON-LD -> Regex -> LLM`

Key extractor refinements:
- `_extract_area` uses contextual candidate scoring
- rejects values `<= 10` or `> 100_000`
- boosts contexts near `área`, `privativa`, `construída`
- penalizes contexts like `condomínio`, `empreendimento`, `lazer`

Preserved extraction patterns:
- price: `r\$\s*([\d.,]+)`
- area: `(\d[\d.,]*)\s*m[²2]`
- bairro: `\bno\s+bairro\s+([^,\-\(]+?)\s+em\s`

LLM fallback:
- model: `gpt-5-nano`
- configured for minimal reasoning

Deterministic extraction direction:
- `SiteTemplate` learning is introduced to reduce LLM dependence
- learns from early sample pages via `LEARN_PAGES=5`
- selector confirmation uses votes plus semantic validation
- two confirmed fields cannot share the same selector
- template is ready only if:
  - at least one core field exists (`titulo` or `preco`)
  - minimum confirmed field threshold is reached

Relationship:
- this work directly supports benchmark goals by pushing extraction toward higher-confidence, lower-LLM behavior

### Search/API/database integration
Also from `buscador_sort_and_extractor_refinements.md`:

Key files:
- `app/(app)/buscador/page.tsx`
- `app/api/imoveis/route.ts`
- `lib/db/queries.ts`

Flow:
- UI state -> authenticated API parsing/validation -> SQL filter/order application -> paginated results

Supported search/filter parameters:
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

Current behavior:
- page size fixed at `12`
- `relevante` and `recentes` currently map to the same backend ordering: `createdAt desc`

Localization detail:
- `parseBRNumber` removes thousand separators, converts decimal commas to dots, and returns `undefined` when invalid

### Fonte reset and recrawl operations
From `reset_crawl_flow_per_source.md`:

Key files:
- `components/fontes/FonteActions.tsx`
- `lib/db/queries.ts`
- `app/api/fontes/[id]/reset-crawl/route.ts`

Flow:
- user clicks `"Apagar e buscar"`
- UI requires explicit confirmation
- backend deletes all imóveis for the fonte via `deleteImoveisByFonteId`
- crawl restarts
- UI polls `/api/fontes/${fonteId}/status`

Safeguards and timing:
- confirmation text: `"Isso vai apagar todos os imóveis dessa URL e iniciar uma nova busca. Continuar?"`
- polling interval: `2500ms`
- first status read after `1000ms`
- max crawl window: `60 minutes`
- stall threshold: `2 minutes` without progress unless `heartbeatAt` shows worker liveness

UI state model:
- separate `syncing` and `resetting` flags
- reset button label changes to `"Limpando..."`
- success path preserves final result briefly, then clears state and triggers `router.refresh()`

Relationship:
- this operational flow is adjacent to benchmark/scraping work and reuses the existing crawl-status infrastructure rather than creating a separate monitoring path

---

## `facts` domain

### Main topic: `project`
This topic stores stable operational facts about where knowledge persists and how the reset-crawl workflow is constrained. It complements `architecture/web_scraping` by capturing baseline truths rather than implementation evolution.

Primary drill-down:
- `project/context.md`
- `project/repository_local_context_tree_reset.md`
- `project/fonte_crawl_reset_constraints.md`

### Stable project facts

#### Repository-local knowledge persistence
From `project/repository_local_context_tree_reset.md`:

Key fact:
- the active curated knowledge store is the repository-local `.brv/context-tree/`

Recorded baseline behavior on `2026-03-29`:
- `reset -> ByteRover CLI writes -> local .brv/context-tree persists curated knowledge`

Dependencies:
- repository contains `.brv/`
- CLI can write to the local context tree

Role separation:
- `project/context.md` provides framing
- `project/repository_local_context_tree_reset.md` is the authoritative source for the persistence-location fact

#### Fonte reset-crawl constraints
From `project/fonte_crawl_reset_constraints.md`:

Core decision:
- reset-crawl is a destructive, single-fonte delete-then-resync workflow

Implementation ownership:
- UI trigger: `components/fontes/FonteActions.tsx`
- backend route: `app/api/fontes/[id]/reset-crawl/route.ts`
- delete helper: `lib/db/queries.ts`
- deletion function: `deleteImoveisByFonteId`

Flow:
- confirm reset
- call reset-crawl endpoint
- delete imóveis for the fonte
- start fresh synchronization
- poll status until completion or error

Behavioral constraints:
- confirmation uses `window.confirm`
- status endpoint: `/api/fontes/${fonteId}/status`
- polling cadence: `2500ms`
- maximum polling window: `60 minutes`
- fallback stall rule: `2 minutes` without progress unless backend heartbeat is recent

Relationship to architecture entries:
- `facts/project/fonte_crawl_reset_constraints.md` captures the durable operational constraints
- `architecture/web_scraping/reset_crawl_flow_per_source.md` covers the richer implementation and UI behavior of the same workflow

---

## Cross-domain relationships
- `architecture/web_scraping/reset_crawl_flow_per_source.md` and `facts/project/fonte_crawl_reset_constraints.md` describe the same reset-crawl system at different abstraction levels:
  - `architecture`: implementation flow, UI state, polling behavior
  - `facts`: stable ownership, endpoint, timing, and operational constraints
- `buscador_sort_and_extractor_refinements.md` connects product search behavior with scraping/extraction quality improvements.
- `shadow_mode_benchmark_reliability.md` is the runtime foundation for benchmark execution.
- `benchmark_timing_breakdown_and_doppler_run_validation.md` extends that foundation with instrumentation and defines the current non-replacement boundary for the candidate pipeline.