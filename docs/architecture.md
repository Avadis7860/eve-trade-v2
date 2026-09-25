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

Background execution for market polling, authenticated character synchronization, normalization, opportunity evaluation and prediction jobs.

### apps/api

Application-facing API. The UI consumes canonical and analytical data from this boundary and never queries ESI directly.

### apps/web

Presentation layer only. It displays data and status supplied by the API.

### packages/contracts

Stable contracts exchanged between applications and modules. Contracts describe data, states and provenance.

### packages/domain

Pure domain models and deterministic business rules. No HTTP or database access.

### packages/esi

ESI transport, authentication, pagination, retry/rate-limit handling and mapping of external responses into internal observations.

### packages/db

Database connections, repositories and persistence helpers.

## Persistence layers

### Raw observations

Append-oriented records representing what was observed from ESI: market orders, wallet data, assets, character orders and similar sources.

### Canonical state

Normalized entities used by the application: items, regions, systems, locations, market orders, characters, wallets, assets and transactions.

### Analytical records

Derived records that can be recomputed: trade candidates, opportunities, opportunity snapshots, prediction inputs/results and observed outcomes.

Source observations remain available so derived models can be rebuilt without recollecting the entire external dataset.

## Data ownership

- Market data is global and is not owned by a character.
- Player data is scoped to its authenticated principal.
- Corporation data is a separate scope and is merged only when authorization and provenance are explicit.
- External observations retain source identity and observation time.
- Unknown, partial and errored states are explicit and are never silently converted into valid numeric values.

## Dependency rule

Build in dependency order: ingestion -> persistence/history -> player state -> trade analysis -> opportunity history -> prediction -> recommendation -> API/UI.

A downstream module consumes explicit upstream contracts. Shortcuts across boundaries require an architectural decision recorded in the repository.
