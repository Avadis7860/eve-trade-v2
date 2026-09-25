# EVE Trade v2

EVE Trade v2 is a market-intelligence and trading-analysis platform for EVE Online.

Target product pipeline:

EVE / ESI -> ingestion -> historical observations -> canonical market and player state -> trade analysis -> opportunity history -> prediction -> recommendation -> web interface.

The repository is a modular monorepo. Components share contracts and domain code, but responsibilities remain explicit.

## Repository layout

- apps/web — user interface
- apps/api — application API boundary
- apps/worker — scheduled/background processing
- packages/contracts — stable shared contracts
- packages/domain — pure business rules
- packages/esi — ESI client and ingestion primitives
- packages/db — database access
- database/migrations — schema history
- docs — architecture, master plan and development rules

See docs/master-plan.md and docs/architecture.md.
