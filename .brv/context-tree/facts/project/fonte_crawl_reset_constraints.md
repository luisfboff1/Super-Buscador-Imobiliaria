---
title: Fonte Crawl Reset Constraints
summary: Project facts for fonte reset-crawl include destructive delete-then-resync behavior, explicit user confirmation, 2.5s status polling, 60-minute polling cap, and 2-minute stall detection with heartbeat exception.
tags: []
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-04-17T19:48:46.779Z'
updatedAt: '2026-04-17T19:48:46.779Z'
---
## Reason
Capture concrete reset-crawl operational facts and timing constraints for later recall.

## Raw Concept
**Task:**
Record factual operational constraints and endpoints for fonte reset-crawl.

**Changes:**
- Introduced reset-crawl endpoint and destructive resynchronization flow.
- Documented polling cadence, timeout cap, and stall detection threshold.

**Files:**
- components/fontes/FonteActions.tsx
- lib/db/queries.ts
- app/api/fontes/[id]/reset-crawl/route.ts

**Flow:**
confirm reset -> call reset-crawl endpoint -> delete source listings -> poll status endpoint until completion or error

**Timestamp:** 2026-04-17

## Narrative
### Structure
These facts describe operational behavior of the fonte reset-crawl path rather than the full crawler implementation. They cover where the behavior lives, which endpoint is called, how often progress is polled, and what timeout values govern recovery from stalls or worker restarts.

### Highlights
The most important constraints are that reset-crawl deletes all current imóveis for one fonte, requires an explicit browser confirmation dialog, and reuses the same progress polling used by normal synchronization.

### Examples
Polling cadence is 2500ms. Maximum polling window is 60 minutes. Stall fallback triggers after 2 minutes without progress unless the backend still reports a recent heartbeat.

## Facts
- **reset_crawl_behavior**: O fluxo reset-crawl apaga todos os imóveis vinculados a uma fonte antes de iniciar nova sincronização. [project]
- **reset_crawl_ui_component**: O botão "Apagar e buscar" da UI fica em components\fontes\FonteActions.tsx. [project]
- **reset_crawl_route**: A rota de reset-crawl está em app/api/fontes/[id]/reset-crawl/route.ts. [project]
- **delete_imoveis_helper**: A exclusão dos imóveis da fonte é feita por deleteImoveisByFonteId em lib\db\queries.ts. [project]
- **crawl_poll_max_ms**: O polling de crawl usa limite máximo de 60 minutos. [project]
- **crawl_stall_timeout**: O backup de segurança detecta travamento após 2 minutos sem progresso, exceto com heartbeat recente. [project]
- **crawl_status_polling**: O polling de status chama /api/fontes/${fonteId}/status a cada 2500ms. [project]
- **reset_crawl_confirmation**: O reset-crawl exige confirmação explícita via window.confirm antes de apagar imóveis. [convention]
