# Fonte Crawl Reset Constraints

## Key points
- **Reset-crawl is destructive:** it deletes all existing **imóveis** tied to a single **fonte** before starting a fresh synchronization.
- **Explicit user confirmation is required:** the UI uses `window.confirm` before deletion can proceed.
- **Polling reuses normal sync progress tracking:** status is polled via `/api/fontes/${fonteId}/status`.
- **Polling cadence is fixed at 2500ms**.
- **Polling has a hard maximum window of 60 minutes**.
- **Stall detection triggers after 2 minutes without progress**, unless the backend still reports a recent heartbeat.
- The implementation spans **UI action**, **API route**, and **database deletion helper** layers.

## Structure / sections summary
- **Reason:** states the purpose as capturing operational facts and timing constraints for reset-crawl.
- **Raw Concept:** summarizes the task, changes introduced, relevant files, and the end-to-end flow:
  - confirm reset
  - call reset-crawl endpoint
  - delete source listings
  - poll status until completion or error
- **Narrative:** clarifies that the document covers reset-crawl operational behavior rather than the full crawler implementation.
- **Highlights:** emphasizes destructive deletion, explicit confirmation, and reuse of sync polling.
- **Examples:** gives concrete timing values for polling, timeout cap, and stall fallback.
- **Facts:** lists specific project facts and conventions with paths and thresholds.

## Notable entities, patterns, or decisions

### Entities
- **UI component:** `components/fontes/FonteActions.tsx`
- **API route:** `app/api/fontes/[id]/reset-crawl/route.ts`
- **DB helper:** `deleteImoveisByFonteId` in `lib/db/queries.ts`
- **Status endpoint:** `/api/fontes/${fonteId}/status`

### Operational pattern
- **Delete-then-resync flow:** reset-crawl does not merge or incrementally repair data; it clears a fonte’s listings first, then starts a new crawl.
- **Shared polling model:** reset-crawl progress uses the same status polling mechanism as standard synchronization.
- **Client-driven confirmation + polling:** the browser initiates confirmation, triggers the reset endpoint, then repeatedly checks status.

### Decisions / constraints
- **Safety decision:** destructive action is gated behind explicit confirmation.
- **Recovery decision:** a **2-minute no-progress threshold** is used for stall fallback, but a **recent heartbeat overrides stall classification**.
- **Bounded waiting decision:** polling is capped at **60 minutes** to prevent indefinite waiting.
- **Responsiveness tradeoff:** polling every **2.5 seconds** balances timely updates with request frequency.