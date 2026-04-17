# Reset Crawl Flow Per Source

## Key points
- Introduces a **destructive reset-crawl flow per fonte**: all associated **imóveis** are deleted before starting a fresh synchronization.
- Adds a dedicated UI action, **“Apagar e buscar”**, with its own **resetting state**, separate from normal syncing.
- Reuses the existing **crawl status polling** flow for both normal crawl and reset-crawl.
- Requires **explicit user confirmation** before deletion via a confirmation prompt.
- Includes safeguards for long-running crawls: **2.5s polling**, **60-minute max runtime**, **stall detection after 2 minutes without progress**, and **heartbeat-aware recovery**.
- On completion or error, the UI clears state and triggers **`router.refresh()`** after briefly preserving final progress/results.

## Structure / sections summary
- **Reason**
  - States the goal: document reset-crawl behavior, UI flow, polling safeguards, and DB deletion helper for fontes.

- **Raw Concept**
  - Summarizes the task, key changes, touched files, and the end-to-end flow:
    - user clicks reset action
    - confirms deletion
    - backend deletes imóveis
    - crawl restarts
    - UI polls status until success/error

- **Narrative**
  - **Structure**: explains responsibilities across:
    - `components/fontes/FonteActions.tsx`
    - `lib/db/queries.ts`
    - `app/api/fontes/[id]/reset-crawl/route.ts`
  - **Dependencies**: lists Next.js navigation/refresh, fetch endpoints, lucide-react, drizzle-orm, and required status payload fields.
  - **Highlights**: emphasizes destructive reset semantics, dedicated UI labels/states, polling cadence, stall handling, and cleanup behavior.
  - **Rules**: captures user-facing confirmation and error/status messages.
  - **Examples**: gives normal crawl, reset crawl, and DB deletion examples.

- **Facts**
  - Confirms implementation details such as route/file locations, helper function name, polling timing, timeout thresholds, and confirmation requirement.

## Notable entities, patterns, or decisions
- **Files / entities**
  - `components/fontes/FonteActions.tsx`
  - `lib/db/queries.ts`
  - `app/api/fontes/[id]/reset-crawl/route.ts`
  - Helper: **`deleteImoveisByFonteId`**
  - Endpoints:
    - `POST /api/fontes/${fonteId}/crawl`
    - `POST /api/fontes/${fonteId}/reset-crawl`
    - `GET /api/fontes/${fonteId}/status`

- **UI/state patterns**
  - Separate flags for **syncing** vs **resetting**
  - Button label transition: **“Apagar e buscar” → “Limpando...”**
  - Reconnect logic resumes polling if page mounts during an active crawl
  - Final status/progress is shown briefly before clearing state

- **Polling / reliability decisions**
  - Poll every **2500ms**
  - First status read after **1000ms**
  - Treat crawl as active up to **60 minutes**
  - Detect stall after **2 minutes without progress**
  - Do **not** mark stalled if **`heartbeatAt`** is still recent
  - Uses status/progress fields such as:
    - `progress.done`
    - `progress.finished`
    - `heartbeatAt`
    - `status === "ok"`
    - `status === "erro"`

- **Destructive-flow decision**
  - Reset-crawl intentionally **deletes all imóveis for a fonte before recrawling**, rather than merging/updating existing data.

- **User-facing messages**
  - Confirmation: *“Isso vai apagar todos os imóveis dessa URL e iniciar uma nova busca. Continuar?”*
  - Failure/recovery examples:
    - *“Crawl sem resposta — o worker pode ter sido reiniciado. Tente sincronizar novamente.”*
    - *“Crawl interrompido”*
    - *“Crawl parece travado (sem progresso há 2 min). Verifique o worker ou tente novamente.”*
    - *“Erro desconhecido”*