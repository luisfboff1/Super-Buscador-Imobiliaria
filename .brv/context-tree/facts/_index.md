---
children_hash: 3744bfe495f2e3ae721bce3ca56b5ff529d416e8424e8d3514a83a3139be768e
compression_ratio: 0.8499095840867993
condensation_order: 2
covers: [context.md, project/_index.md]
covers_token_total: 553
summary_level: d2
token_count: 470
type: summary
---
# Facts / Project

## Structural Overview
The `facts` domain holds stable, repository-wide operational knowledge. Within it, the `project` topic currently centers on one persistent infrastructure fact: curated knowledge for Super-Buscador-Imobiliaria is stored in the repository-local `.brv/context-tree/`, including after reset-related workflows.

## Domain Scope
From `context.md`:
- Intended for durable project facts, environment details, and repository-wide technical/operational knowledge.
- Includes stable tooling and persistence facts useful across the repo.
- Excludes feature-specific implementation details and short-lived task planning.

## Topic Structure
From `project/_index.md`, the `project` topic condenses:
- `context.md` — topic/domain framing for repository-local context storage and persistence behavior.
- `repository_local_context_tree_reset.md` — canonical fact record for reset-related persistence behavior.

## Key Preserved Facts
- The authoritative write target for curated knowledge is `.brv/context-tree/`.
- Storage is repository-local, not an external system.
- The reset-related persistence fact was explicitly recorded on `2026-03-29`.
- Operational flow captured in `repository_local_context_tree_reset.md`:
  - `reset -> ByteRover CLI writes -> repository-local .brv context tree persists curated knowledge`

## Dependencies and Conditions
- The repository must contain a local `.brv` directory.
- Curation flows depend on write access to `.brv/context-tree/`.

## Relationships
- `facts/context.md` defines the domain’s purpose and boundaries.
- `project/_index.md` summarizes the current `project` topic structure and points readers to `repository_local_context_tree_reset.md` for the detailed persistence artifact.
- `repository_local_context_tree_reset.md` is the drill-down source for validating post-reset curation persistence behavior.