# EVE Trade v2 — Architecture

## System boundary

ESI is an external source, not the internal database.

External ESI
  |
  v
packages/esi + apps/worker
  |
  v
raw observations
  |
  v
canonical persisted state
  |
  +-------------------+
  |                   |
  v                   v
market analysis    player financial state
  |                   |
  +---------+---------+
            v
       trade analysis
            |
            v
      opportunity history
            |
            v
        prediction
            |
            v
       recommendation
            |
            v
           API
            |
            v
           Web

## Application boundaries

### apps/worker

Background processing for market ingestion, normalization, analysis and prediction jobs. Phase 1 places orchestration here while reusable transport, contracts, domain reduction and persistence remain in packages.

### apps/api

Application-facing API. The UI consumes canonical and analytical data from this boundary and never queries ESI directly.

### apps/web

Presentation layer only. It displays data and status supplied by the API.

### packages/contracts

Stable contracts exchanged between applications and packages. Phase 1 contracts explicitly carry availability status, source provenance, observation time, page identity, raw payload and response metadata.

### packages/domain

Pure domain models and deterministic business rules. Phase 1 contains the market reconstruction reducer. It has no HTTP or database access.

### packages/esi

ESI transport, market pagination, retry/rate-limit handling and conversion of external responses into raw market observations. The client does not create canonical state.

### packages/db

PostgreSQL access and persistence helpers. Phase 1 stores append-oriented market collection/page observations plus a derived canonical market state.

## Persistence layers

### Raw observations

Append-oriented records representing what was observed from ESI. Phase 1 stores each market-order page with its collection identity, page number, observation timestamp, provenance, raw payload and HTTP/cache/rate-limit metadata.

### Canonical state

Normalized entities used by the application. Phase 1 materializes a canonical market snapshot only after all advertised pages are available and the page cache Last-Modified values are either consistently equal or unavailable. Duplicate order IDs across pages are deduplicated by order ID while the duplicate count remains observable.

### Analytical records

Derived records that can be recomputed: trade candidates, opportunities, opportunity snapshots, prediction inputs/results and observed outcomes.

Source observations remain available so derived models can be rebuilt without recollecting the entire external dataset.

## Data ownership

- Market data is global and is not owned by a character.
- Player data is scoped to its authenticated principal.
- Corporation data is a separate scope and is merged only when authorization and provenance are explicit.
- External observations retain source identity and observation time.
- Unknown, partial and errored states are explicit and are never silently converted into valid numeric values.

## Phase 1 consistency rule

ESI documents X-Pages pagination for the market orders route and warns that page-cache expiry can cause overlap between pages. ESI also documents that Last-Modified should remain the same across pages of a paginated resource and can be used to validate a coherent retrieval. Therefore Phase 1 does not equate "all HTTP requests returned 200" with "complete canonical snapshot": an inconsistent Last-Modified set produces PARTIAL state, while failed pages produce ERROR state.

## Dependency rule

Build in dependency order: ingestion -> persistence/history -> player state -> trade analysis -> opportunity history -> prediction -> recommendation -> API/UI.

A downstream module consumes explicit upstream contracts. Shortcuts across boundaries require an architectural decision recorded in the repository.
