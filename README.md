# EVE Trade v2

EVE Trade v2 is a market-intelligence and trading-analysis platform for EVE Online.

Target product pipeline:

EVE / ESI -> ingestion -> historical observations -> canonical market and player state -> trade analysis -> opportunity history -> prediction -> recommendation -> web interface.

## Phase 1

Phase 1 implements the first real data path:

ESI market orders -> paginated raw observations -> PostgreSQL persistence -> deterministic canonical market state -> reconstructible market history.

The ingestion boundary preserves provenance, observation timestamps, HTTP/cache/rate-limit metadata and raw payloads. Incomplete or errored collections are never represented as an empty valid market.

## Repository layout

- apps/web — user interface
- apps/api — application API boundary
- apps/worker — background processing
- packages/contracts — stable shared contracts
- packages/domain — pure business rules
- packages/esi — ESI client and ingestion primitives
- packages/db — PostgreSQL persistence
- database/migrations — schema history
- docs — architecture, master plan and development rules

## Local validation

Install dependencies with pnpm 10.15+, apply database/migrations/001_market_ingestion.sql to the PostgreSQL database configured by DATABASE_URL, then run:

pnpm typecheck
pnpm test

The Phase 1 integration path is the worker ingestion function using the ESI client and market observation repository. Phase 2 rebuilds historical state from persisted observations without calling ESI. Apply migrations in lexical order, including `002_market_history.sql`, before PostgreSQL validation. A PostgreSQL instance is required for persistence validation.
