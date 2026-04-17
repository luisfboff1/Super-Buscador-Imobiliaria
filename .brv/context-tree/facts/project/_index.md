---
children_hash: 21613cd878c71e9951d05cb99683d2a798a9e7c3077a714f638828eb1def3e89
compression_ratio: 0.8962432915921288
condensation_order: 1
covers: [context.md, fonte_crawl_reset_constraints.md, repository_local_context_tree_reset.md]
covers_token_total: 1118
summary_level: d1
token_count: 1002
type: summary
---
# facts/project

## Overview
This topic captures stable project-level operational facts for the repository, centered on two areas:

- where ByteRover CLI persists curated knowledge after a reset (`context.md`, `repository_local_context_tree_reset.md`)
- how the fonte reset-crawl flow behaves in the app and backend (`fonte_crawl_reset_constraints.md`)

Together, these entries describe both repository-local knowledge persistence and a destructive fonte resynchronization workflow with explicit timing and safety constraints.

## Entry Map

### `context.md`
- Serves as the topic overview for `project`
- Establishes that the repository-local `.brv` context tree is the active persistence target after a reset during a CLI test memory run
- Frames the topic around:
  - repository-local `.brv` storage
  - ByteRover CLI persistence behavior
  - post-reset state

### `repository_local_context_tree_reset.md`
- Records a dated repository fact:
  - On `2026-03-29`, ByteRover CLI writes curated knowledge into the local `.brv/context-tree/`
- Key flow:
  - `reset -> ByteRover CLI writes -> repository-local .brv context tree persists curated knowledge`
- Important dependency:
  - the repo must contain `.brv/`
  - the CLI must have write access to that local context tree
- This entry is the drill-down source for the persistence-location baseline fact

### `fonte_crawl_reset_constraints.md`
- Records concrete operational behavior for fonte reset-crawl
- Core architectural decision:
  - reset-crawl is a destructive delete-then-resync flow for a single fonte
- Main flow:
  - `confirm reset -> call reset-crawl endpoint -> delete source listings -> poll status endpoint until completion or error`
- Relevant code locations:
  - UI trigger: `components/fontes/FonteActions.tsx`
  - delete helper: `lib/db/queries.ts` via `deleteImoveisByFonteId`
  - API route: `app/api/fontes/[id]/reset-crawl/route.ts`
- Shared runtime pattern:
  - reset-crawl reuses the same progress polling model as normal synchronization

## Key Facts Preserved

### Repository-local context persistence
From `context.md` and `repository_local_context_tree_reset.md`:

- The active curated knowledge store is the repository-local `.brv/context-tree/`
- This behavior is explicitly recorded as post-reset CLI behavior
- The dated baseline for that fact is `2026-03-29`
- This topic should be used as the reference point when validating that curation is persisting locally rather than elsewhere

### Fonte reset-crawl behavior
From `fonte_crawl_reset_constraints.md`:

- Reset-crawl deletes all imóveis linked to a fonte before starting a fresh sync
- The UI action is the `"Apagar e buscar"` button in `components/fontes/FonteActions.tsx`
- The backend route is `app/api/fontes/[id]/reset-crawl/route.ts`
- Deletion is performed through `deleteImoveisByFonteId` in `lib/db/queries.ts`
- The browser requires explicit user confirmation through `window.confirm`
- Status polling hits `/api/fontes/${fonteId}/status`
- Polling cadence is `2500ms`
- Maximum polling window is `60 minutes`
- Stall detection fallback triggers after `2 minutes` without progress, unless the backend still reports a recent heartbeat

## Relationships and Patterns

- `context.md` is the top-level framing entry; `repository_local_context_tree_reset.md` provides the concrete dated fact behind that overview.
- `fonte_crawl_reset_constraints.md` is a separate operational fact cluster under the same `facts/project` topic, focused on crawler reset behavior rather than context persistence.
- A recurring pattern across the topic is operational baseline capture:
  - where state is persisted
  - which component/route owns an action
  - what timing thresholds govern recovery and monitoring

## Drill-down Guide

- For local knowledge persistence after reset: `repository_local_context_tree_reset.md`
- For destructive fonte resync flow, files, endpoint, and polling thresholds: `fonte_crawl_reset_constraints.md`
- For topic framing and scope: `context.md`