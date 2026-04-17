---
title: Reset Crawl Flow Per Source
summary: Reset-crawl flow for fontes deletes source listings, requires explicit confirmation, reuses crawl polling, and restarts synchronization with stall and heartbeat safeguards.
tags: []
related: [architecture/web_scraping/context.md]
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-04-17T19:48:46.774Z'
updatedAt: '2026-04-17T19:48:46.774Z'
---
## Reason
Document reset-crawl behavior, UI control flow, polling safeguards, and database deletion helper for fontes.

## Raw Concept
**Task:**
Document reset-crawl flow for a fonte, including UI actions, polling lifecycle, and database deletion behavior.

**Changes:**
- Added reset-crawl flow to delete all imóveis for a fonte before starting a fresh synchronization.
- Added UI action "Apagar e buscar" with dedicated resetting state alongside syncing state.
- Reused existing crawl progress polling for both normal crawl and reset-crawl.
- Added deleteImoveisByFonteId helper to remove all imóveis for a fonte.

**Files:**
- components/fontes/FonteActions.tsx
- lib/db/queries.ts
- app/api/fontes/[id]/reset-crawl/route.ts

**Flow:**
user clicks "Apagar e buscar" -> UI asks for confirmation -> POST /api/fontes/${fonteId}/reset-crawl -> backend deletes imóveis da fonte -> crawl restarts -> UI polls /api/fontes/${fonteId}/status -> success or error state clears and refreshes router

**Timestamp:** 2026-04-17

## Narrative
### Structure
The reset-crawl behavior spans the fonte actions client component, database query helpers, and a dedicated API route. In FonteActions.tsx the component keeps separate syncing and resetting flags, a CrawlProgress object for progress rendering, interval references for status polling, and reconnect logic that resumes polling when the page mounts during an in-flight crawl. The database layer in lib/db/queries.ts provides source statistics, fonte CRUD, search helpers, favorite toggling, crawler upsert helpers, markImoveisIndisponiveis, and the dedicated deleteImoveisByFonteId function used by reset-crawl to clear existing imóveis for one fonte.

### Dependencies
The client depends on Next.js navigation refresh, fetch calls to /api/fontes/${fonteId}/crawl, /api/fontes/${fonteId}/reset-crawl, and /api/fontes/${fonteId}/status, plus lucide-react icons for status rendering. The database helpers depend on drizzle-orm, db, tenantSchema, and authSchema. Polling correctness also depends on status payloads that expose progress.done, progress.finished, heartbeatAt, status === "ok", and status === "erro" so the UI can detect completion, worker restarts, and stalls.

### Highlights
Reset-crawl is intentionally destructive before resynchronization: it deletes all imóveis tied to the selected fonte and then starts a fresh crawl. The UI distinguishes normal synchronization from reset mode with a dedicated resetting flag and button label transition from "Apagar e buscar" to "Limpando...". Polling runs every 2.5 seconds, allows crawls to remain active for up to 60 minutes, and only treats a crawl as stalled after 2 minutes without progress unless a recent heartbeat shows the worker is still alive. On successful completion the component preserves the final result briefly, then clears syncing, resetting, and progress state and calls router.refresh().

### Rules
"Isso vai apagar todos os imóveis dessa URL e iniciar uma nova busca. Continuar?"
"Crawl sem resposta — o worker pode ter sido reiniciado. Tente sincronizar novamente."
"Crawl interrompido"
"Crawl parece travado (sem progresso há 2 min). Verifique o worker ou tente novamente."
"Erro desconhecido"

### Examples
Normal sync path: POST /api/fontes/${fonteId}/crawl, then start polling every 2500ms with a first status read after 1000ms. Reset sync path: user confirms destruction, POST /api/fontes/${fonteId}/reset-crawl, then reuse the same polling cadence and completion cleanup. Database deletion helper: delete from tenantSchema.imoveis where tenantSchema.imoveis.fonteId equals the selected fonteId.

## Facts
- **reset_crawl_behavior**: O fluxo reset-crawl apaga todos os imóveis vinculados a uma fonte antes de iniciar nova sincronização. [project]
- **reset_crawl_ui_component**: O botão "Apagar e buscar" da UI fica em components\fontes\FonteActions.tsx. [project]
- **reset_crawl_route**: A rota de reset-crawl está em app/api/fontes/[id]/reset-crawl/route.ts. [project]
- **delete_imoveis_helper**: A exclusão dos imóveis da fonte é feita por deleteImoveisByFonteId em lib\db\queries.ts. [project]
- **crawl_poll_max_ms**: O polling de crawl usa limite máximo de 60 minutos. [project]
- **crawl_stall_timeout**: O backup de segurança detecta travamento após 2 minutos sem progresso, exceto com heartbeat recente. [project]
- **crawl_status_polling**: O polling de status chama /api/fontes/${fonteId}/status a cada 2500ms. [project]
- **reset_crawl_confirmation**: O reset-crawl exige confirmação explícita via window.confirm antes de apagar imóveis. [convention]
