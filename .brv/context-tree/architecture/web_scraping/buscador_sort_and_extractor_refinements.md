---
title: Buscador Sort And Extractor Refinements
summary: Documents end-to-end search sorting, API filter parsing, contextual area extraction, and SiteTemplate selector learning for property scraping.
tags: []
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-04-17T18:59:13.497Z'
updatedAt: '2026-04-17T18:59:13.497Z'
---
## Reason
Curate RLM summary of property search sorting, API/query integration, and extractor/template learning refinements.

## Raw Concept
**Task:**
Document buscador de imóveis sorting implementation and extractor refinements for web scraping and search behavior.

**Changes:**
- Added end-to-end sortBy support across app/(app)/buscador/page.tsx, app/api/imoveis/route.ts, and lib/db/queries.ts
- Added advanced filters bairro, areaMin, areaMax, and sortBy propagation from UI to API
- Implemented Brazilian numeric parsing in /api/imoveis for price and area filters
- Refined worker-python/app/extractor.py area_m2 extraction using contextual candidate scoring
- Documented SiteTemplate selector-learning flow with LLM-assisted vote confirmation and readiness thresholds

**Files:**
- app/api/imoveis/route.ts
- lib/db/queries.ts
- app/(app)/buscador/page.tsx
- worker-python/app/extractor.py

**Flow:**
UI filters and sort selection -> /api/imoveis parses and validates params -> lib/db/queries.ts applies SQL filters and ordering -> results paginate in UI; scraper extraction runs JSON-LD -> regex -> LLM, while SiteTemplate learns selectors from early samples and later extracts without LLM when ready.

**Timestamp:** 2026-04-17

**Patterns:**
- `r\$\s*([\d.,]+)` (flags: i) - Regex used to extract price values from page text
- `(\d[\d.,]*)\s*m[²2]` - Regex used to collect area candidates in square meters
- `\bno\s+bairro\s+([^,\-\(]+?)\s+em\s` (flags: i) - Regex used to extract bairro from SEO-style location text

## Narrative
### Structure
The search stack spans the client page app/(app)/buscador/page.tsx, the authenticated API route app/api/imoveis/route.ts, and the database query layer in lib/db/queries.ts. The extractor logic in worker-python/app/extractor.py combines direct field extraction, LLM fallback, selector discovery, and a reusable SiteTemplate class for domain-specific extraction without repeated model calls.

### Dependencies
The API requires an authenticated session and depends on lib/db/queries.ts to execute filtering and ordering. The extractor depends on JSON-LD availability, regex parsing, OpenAI chat completions for missing fields and selector discovery, and DOM parsing for selector-based extraction. SiteTemplate readiness depends on LEARN_PAGES=5, minimum votes, and semantic validation for ambiguous numeric selectors.

### Highlights
The UI now supports bairro, areaMin, areaMax, and sortBy filters and sanitizes numeric text inputs with replace(/[^\d.,]/g, ""). Sorting options include relevante, preco_asc, preco_desc, area_desc, and recentes, but relevante and recentes currently resolve to the same backend ordering by createdAt desc. Area extraction now scores multiple m² candidates by nearby semantic context, improving discrimination between useful area and unrelated condominium or leisure metrics. Template learning confirms selectors only after vote accumulation and extra semantic validation, reducing false positives for fields like bairro, cidade, vagas, quartos, banheiros, and area_m2.

### Rules
Sort values accepted by the API: relevante, preco_asc, preco_desc, area_desc, recentes.
The endpoint requires authentication and returns 401 with { error: "Não autorizado" } when there is no session.
parseBRNumber removes thousand separators, converts decimal commas to dots, and returns undefined for invalid values.
_extract_area discards candidates with area <= 10 or area > 100_000, scores positive context for área/privativa/construída terms, penalizes condomínio/empreendimento/lazer context, prefers early matches, and breaks ties by position.
SiteTemplate confirms selectors with votes, prevents two confirmed fields from sharing the same selector, and only becomes ready when at least one core field among titulo or preco exists and len(self.confirmed) >= MIN_FIELDS.

### Examples
Ordering example in lib/db/queries.ts: preco_asc orders by asc(preco::numeric) then desc(createdAt), preco_desc orders by desc(preco::numeric), and area_desc orders by desc(areaM2::numeric). UI example: changing the sort select immediately triggers fetchPage(1, { ...filtros, sortBy }) when a result set already exists. Extraction example: a string like "Loja Térrea para comprar no bairro CENTRO em Caxias do Sul - COD. 3698" is sanitized so bairro becomes "CENTRO". Learning example: SiteTemplate uses the first 5 URLs for LLM-backed extraction, collects selector votes, and then switches remaining URLs to selector-only extraction if confirmation thresholds are met.

## Facts
- **imoveis_sortby_pipeline**: A busca de imóveis suporta sortBy fim-a-fim entre UI, API e query layer. [project]
- **imoveis_sort_options**: As opções de ordenação aceitas são relevante, preco_asc, preco_desc, area_desc e recentes. [project]
- **imoveis_api_page_size**: O endpoint /api/imoveis fixa pageSize em 12. [project]
- **imoveis_default_sort_behavior**: Os modos relevante e recentes atualmente caem no mesmo comportamento de backend: createdAt desc. [project]
- **extractor_area_scoring**: A extração de area_m2 em worker-python/app/extractor.py usa score contextual entre múltiplos matches de m². [project]
- **extractor_cascade_flow**: O pipeline de extração usa cascata JSON-LD -> Regex -> LLM. [project]
- **extractor_llm_model**: O modelo usado pelo extractor para preenchimento de campos faltantes é gpt-5-nano com reasoning minimal. [project]
- **site_template_learning_strategy**: O SiteTemplate aprende seletores CSS nas primeiras 5 URLs e confirma seletores com votos mínimos antes de operar sem LLM. [project]
