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

## Phase 4 — Trade analysis

Phase 4 provides deterministic market trade analysis over persisted market and player contracts. It supports taker simulations against observed sell and buy liquidity, explicit capital and fee context, logistics completeness, freshness validation and reproducible economic results.

Phase 4 remains simulation-only: it does not place, modify or cancel orders and does not claim realized P&L.

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

Install dependencies with the pnpm version declared by `packageManager`, apply migrations in lexical order, then run:

pnpm typecheck
pnpm test

A PostgreSQL instance is required for persistence validation. Player synchronization can be exercised from the worker entry point with `PLAYER_CHARACTER_ID` and an injected `ESI_ACCESS_TOKEN`; the token is not written to Player observations. Set `ESI_COMPATIBILITY_DATE` to override the pinned P3 ESI compatibility date after an explicit compatibility review.

## CI and repository automation

The repository CI is defined in `.github/workflows/ci.yml`.

On pull requests targeting `main`, and on pushes to `main`, CI runs one validation job with:

- Ubuntu latest
- Node.js 24
- the exact pnpm version declared by `packageManager`
- PostgreSQL 16
- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm test`

The workflow also exposes `workflow_dispatch`, uses minimal `contents: read` permissions, cancels obsolete runs for the same PR/ref, enforces a 10-minute job timeout and caches the pnpm store from `pnpm-lock.yaml`.

The repository does not require `pnpm lint` in CI yet because the workspaces do not currently expose a homogeneous lint contract.

Pull requests also receive a dedicated Dependency Review check. It blocks newly introduced dependencies with high or critical known vulnerabilities; license checking is intentionally disabled for now to keep this gate focused on supply-chain vulnerability risk.

Dependabot is configured weekly for the root npm/pnpm workspace, groups minor and patch version updates, groups security updates and limits normal version-update pull requests to three open items.

CI does not call ESI and does not require EVE credentials or application secrets.

CodeQL is intentionally not enabled yet; it is a later security-control decision once the deployed/API surface justifies the additional analysis.

Repository administration still needs owner-side verification for branch protection and required checks. No deployment, release or application scheduler is part of the CI foundation.
