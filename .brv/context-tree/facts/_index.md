---
children_hash: ce41866d63d435d4b418de51265b50ff5b6aa626d304e22897e0a22863f36462
compression_ratio: 0.5561015561015561
condensation_order: 2
covers: [context.md, project/_index.md]
covers_token_total: 1221
summary_level: d2
token_count: 679
type: summary
---
# facts

## Purpose and Scope
The `facts` domain stores stable, repository-wide operational knowledge rather than feature implementation detail. It is meant for persistent technical choices, environment/tooling facts, and baseline behaviors that future work can rely on.

## Primary Topic: `project`
`facts/project` groups durable project facts into two main clusters:

- local ByteRover knowledge persistence after reset
- fonte reset-crawl operational constraints

See `project/_index.md` for the synthesized topic map.

## Structural Overview

### 1. Repository-local knowledge persistence
Covered by:
- `project/context.md`
- `project/repository_local_context_tree_reset.md`

Key fact:
- The active curated knowledge store is the repository-local `.brv/context-tree/`.

Baseline behavior:
- On `2026-03-29`, ByteRover CLI persistence is recorded as:
  - `reset -> ByteRover CLI writes -> local .brv/context-tree persists curated knowledge`

Dependencies and constraints:
- The repository must contain `.brv/`
- The CLI must be able to write to the local context tree

Relationship:
- `project/context.md` provides topic framing
- `project/repository_local_context_tree_reset.md` is the authoritative drill-down for the dated persistence-location fact

### 2. Fonte reset-crawl behavior
Covered by:
- `project/fonte_crawl_reset_constraints.md`

Core architectural decision:
- Reset-crawl is a destructive, single-fonte delete-then-resync flow.

Operational flow:
- confirm reset
- call reset-crawl endpoint
- delete imóveis for the fonte
- start fresh synchronization
- poll status until completion or error

Key implementation references:
- UI trigger: `components/fontes/FonteActions.tsx`
- Backend route: `app/api/fontes/[id]/reset-crawl/route.ts`
- Delete helper: `lib/db/queries.ts`
- Deletion function: `deleteImoveisByFonteId`

Behavioral constraints:
- User confirmation uses `window.confirm`
- Status polling endpoint: `/api/fontes/${fonteId}/status`
- Polling cadence: `2500ms`
- Maximum polling window: `60 minutes`
- Stall fallback: `2 minutes` without progress unless backend heartbeat is still recent

Runtime pattern:
- Reset-crawl reuses the same progress polling model as normal synchronization

## Cross-entry Patterns
Across `facts/project`, the recurring pattern is operational baseline capture:
- where durable state is stored
- which file/route owns a workflow
- what timing thresholds govern monitoring and recovery

## Drill-down Map
- Topic framing and scope: `project/context.md`
- Local `.brv/context-tree` persistence fact: `project/repository_local_context_tree_reset.md`
- Reset-crawl ownership, endpoint, file paths, and timing constraints: `project/fonte_crawl_reset_constraints.md`