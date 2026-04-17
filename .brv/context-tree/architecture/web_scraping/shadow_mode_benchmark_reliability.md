---
title: Shadow Mode Benchmark Reliability
tags: []
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-03-31T13:52:11.810Z'
updatedAt: '2026-03-31T13:52:11.810Z'
---
## Raw Concept
**Task:**
Document local benchmark reliability adjustments for web scraping shadow mode and the benchmark results observed on Neon.

**Changes:**
- Added .env.local loading in worker-python/main.py so benchmark CLI works from repo root
- Added DATABASE_URL_UNPOOLED fallback in worker-python/app/db.py when pooled Neon connection fails through psycopg2
- Ran and persisted real discovery and extraction benchmark comparisons for Imobiliaria Connect
- Identified local environment issues that degrade LLM fallback benchmarking

**Files:**
- worker-python/main.py
- worker-python/app/db.py
- .env.local

**Flow:**
benchmark CLI start -> load .env and .env.local -> connect with DATABASE_URL or fallback DATABASE_URL_UNPOOLED -> create benchmark tables on Neon -> run discovery/extraction comparisons -> persist run ids and compare candidate vs legacy

**Timestamp:** 2026-03-31

**Patterns:**
- `ad023d50-3350-4ad8-b741-2622be26f131` - Fonte id used for the verified benchmark run (Imobiliaria Connect)
- `4bee6042-ba7a-4400-929b-0475394d995b|836226ac-522f-43b8-81e3-01abc64e6156|02db8b9c-7fcf-4b12-8260-9b5d71978047` - Discovery benchmark run and comparison ids
- `46af90f5-ee57-4759-a456-2617e62acc5a|a897876b-8bec-4580-ba22-3fc828e99d99|e8d3c617-3b6e-43d3-ad82-e399e5b8c832` - Extraction benchmark run and comparison ids

## Narrative
### Structure
Shadow mode benchmarking depends on the Python worker entrypoint and database connection module. The local benchmark path now supports repo-root execution by loading .env.local alongside .env, and database access in benchmark mode tolerates pooled Neon connection failures by retrying with the unpooled URL. Benchmark evidence was collected against the Imobiliaria Connect fonte and persisted with concrete run identifiers for both discovery and extraction comparisons.

### Dependencies
Requires Neon database availability, benchmark table creation permissions, valid DATABASE_URL or DATABASE_URL_UNPOOLED values, and a valid OPENAI_API_KEY when LLM fallback paths need to execute. Local execution is currently impacted by malformed doppler command lines in .env.local near lines 35-37 and by an invalid OPENAI_API_KEY in this environment.

### Highlights
Discovery benchmark persisted two runs and one comparison where the candidate found 41 detail URLs, legacy found 40, and overlap was 40. Extraction benchmark on a sample size of 5 persisted two runs and one comparison where the candidate produced 4 approved and 1 warn with zero LLM calls, while the legacy path produced 5 warn with 5 LLM calls. This indicates the candidate path improved extraction quality and eliminated LLM calls in the sampled run.

### Examples
Discovery run ids: 4bee6042-ba7a-4400-929b-0475394d995b and 836226ac-522f-43b8-81e3-01abc64e6156. Discovery comparison id: 02db8b9c-7fcf-4b12-8260-9b5d71978047. Extraction run ids: 46af90f5-ee57-4759-a456-2617e62acc5a and a897876b-8bec-4580-ba22-3fc828e99d99. Extraction comparison id: e8d3c617-3b6e-43d3-ad82-e399e5b8c832.

## Facts
- **benchmark_env_loading**: worker-python/main.py now loads .env.local in addition to .env so the benchmark CLI can run from the repo root. [project]
- **database_connection_fallback**: worker-python/app/db.py tries DATABASE_URL first and falls back to DATABASE_URL_UNPOOLED when psycopg2 cannot connect to the pooled Neon URL. [project]
- **discovery_benchmark_runs**: Discovery benchmark for fonte ad023d50-3350-4ad8-b741-2622be26f131 (Imobiliaria Connect) persisted run ids 4bee6042-ba7a-4400-929b-0475394d995b and 836226ac-522f-43b8-81e3-01abc64e6156 with comparison 02db8b9c-7fcf-4b12-8260-9b5d71978047. [project]
- **discovery_benchmark_result**: Discovery benchmark candidate found 41 detail URLs versus 40 legacy with 40 overlap. [project]
- **extraction_benchmark_runs**: Extraction benchmark with existing detail URLs sample size 5 persisted run ids 46af90f5-ee57-4759-a456-2617e62acc5a and a897876b-8bec-4580-ba22-3fc828e99d99 with comparison e8d3c617-3b6e-43d3-ad82-e399e5b8c832. [project]
- **extraction_benchmark_outcome**: Extraction benchmark candidate produced 4 approved and 1 warn with 0 llm calls, while legacy produced 5 warn with 5 llm calls. [project]
- **env_local_malformed_lines**: Current local .env.local contains malformed doppler command lines near lines 35-37. [environment]
- **openai_api_key_status**: OPENAI_API_KEY is invalid in the current environment, so LLM fallback benchmark execution is degraded. [environment]
