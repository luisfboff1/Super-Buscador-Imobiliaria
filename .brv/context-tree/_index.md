---
children_hash: dc159071ab9a57665d05cac6164f261c0fed1f0942f12b5d58d9338bc3c910c9
compression_ratio: 0.8728971962616823
condensation_order: 3
covers: [facts/_index.md]
covers_token_total: 535
summary_level: d3
token_count: 467
type: summary
---
# Facts

## Overview
The `facts` domain captures stable, repository-wide operational knowledge for Super-Buscador-Imobiliaria. At this level, the domain is primarily organized around the `project` topic, which documents persistent infrastructure facts about where curated knowledge lives and how it behaves across reset workflows.

## Scope and Boundaries
From `facts/context.md` and `facts/_index.md`:
- Includes durable project facts, environment details, and repository-wide technical/operational knowledge.
- Focuses on stable tooling and persistence behavior that applies across the repository.
- Excludes feature-specific implementation details and short-lived planning or task notes.

## Topic Structure
### `project`
Referenced by `project/_index.md`:
- `context.md` — framing for project-level facts and repository-local knowledge storage.
- `repository_local_context_tree_reset.md` — canonical record of reset-related persistence behavior.

## Key Preserved Facts
From `facts/_index.md`:
- Curated knowledge is stored in the repository-local `.brv/context-tree/`.
- `.brv/context-tree/` is the authoritative write target for curated knowledge.
- Storage is local to the repository rather than external.
- A reset-related persistence fact was explicitly recorded on `2026-03-29`.

## Operational Pattern
Drill down to `project/repository_local_context_tree_reset.md` for the detailed persistence artifact. The preserved flow is:

- `reset -> ByteRover CLI writes -> repository-local .brv context tree persists curated knowledge`

## Relationships
- `facts/context.md` defines the domain purpose and inclusion boundaries.
- `project/_index.md` summarizes the `project` topic and directs readers to the persistence-specific entry.
- `repository_local_context_tree_reset.md` is the authoritative drill-down for validating post-reset curation persistence behavior.