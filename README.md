# EVE Trade v2

EVE Trade v2 is a market-intelligence and trading-analysis platform for EVE Online.

Target product pipeline:

EVE / ESI -> ingestion -> historical observations -> canonical market and player state -> trade analysis -> opportunity history -> prediction -> recommendation -> web interface.

## Phase 1

Phase 1 implements the first real market data path:

ESI market orders -> paginated raw observations -> PostgreSQL persistence -> deterministic canonical market state -> reconstructible market history.

The ingestion boundary preserves provenance, observation timestamps, HTTP/cache/rate-limit metadata and raw payloads. Incomplete or errored collections are never represented as an empty valid market.

## Phase 2

Phase 2 reconstructs historical market state exclusively from persisted Phase 1 observations. Derived history remains rebuildable and never replaces the raw observation source.

## Phase 3 — Player data

Phase 3 adds a character-scoped Player Data foundation:

character principal -> authenticated ESI -> raw Player observations -> canonical Player state.

The initial scope covers character identity, wallet balance, wallet journal, wallet transactions, assets and active market orders. Public market observations remain PUBLIC; authenticated Player observations are CHARACTER-scoped. Unknown, partial and errored data remain explicit, and raw observations retain provenance and observation timestamps.

P3 does not implement trade profitability, ROI, recommendations, allocation or order execution.

## Repository layout

- apps/web — user interface
- apps/api — application API boundary
- apps/worker — background processing
- packages/contracts — stable shared contracts
- packages/domain — pure business rules
- packages/esi — ESI transport and typed clients
- packages/db — PostgreSQL persistence
- database/migrations — schema history
- docs — architecture, master plan and development rules

## Local validation

Install dependencies with pnpm 10.15+, apply migrations in lexical order, then run:

pnpm typecheck
pnpm test

A PostgreSQL instance is required for persistence validation. Player synchronization can be exercised from the worker entry point with `PLAYER_CHARACTER_ID` and an injected `ESI_ACCESS_TOKEN`; the token is not written to Player observations. Set `ESI_COMPATIBILITY_DATE` to override the pinned P3 ESI compatibility date after an explicit compatibility review.
