---
children_hash: 1a3d71845cd3a241765962331e51c0b7cc91c05ec7f55cc372a919ff3e8dc869
compression_ratio: 0.7903225806451613
condensation_order: 1
covers: [context.md, repository_local_context_tree_reset.md]
covers_token_total: 434
summary_level: d1
token_count: 343
type: summary
---
# Project

## Structural Overview
The `project` topic records a repository-level persistence fact for Super-Buscador-Imobiliaria: after a reset, ByteRover CLI writes curated knowledge into the repository-local `.brv/context-tree/`.

## Child Entries
- `context.md`
  - Acts as the topic overview.
  - Defines the scope around repository-local context storage, CLI persistence behavior, and post-reset state.
- `repository_local_context_tree_reset.md`
  - Canonical fact record for the reset-related persistence behavior.
  - Dated `2026-03-29`.
  - Identifies `.brv/context-tree/` as the write target.
  - Captures the operational flow: `reset -> ByteRover CLI writes -> repository-local .brv context tree persists curated knowledge`.

## Key Facts
- The write location is local to the repository, not an external store.
- The behavior was explicitly recorded on `2026-03-29`.
- This serves as a baseline validation point for curation persistence in the repo.

## Dependencies and Conditions
- The repository must contain a local `.brv` directory.
- The CLI must have write access to `.brv/context-tree/` during curation flows.

## Relationships and Usage
- `context.md` summarizes the domain/topic purpose.
- `repository_local_context_tree_reset.md` provides the detailed operational note and fact artifact to drill into when verifying persistence behavior after resets.