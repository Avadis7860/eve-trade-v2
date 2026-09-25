# EVE Trade v2

[![CI](https://github.com/Avadis7860/eve-trade-v2/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Avadis7860/eve-trade-v2/actions/workflows/ci.yml)

**EVE Trade v2** is a market-intelligence and trading-analysis platform for EVE Online.

Its purpose is to turn external EVE market and player observations into **reconstructible data, deterministic analysis and traceable intelligence**.

## Product

The product pipeline is:

```
EVE / ESI
   ↓
observations
   ↓
canonical market & player state
   ↓
historical market intelligence
   ↓
trade analysis
   ↓
opportunity tracking
   ↓
prediction
   ↓
future scoring / advice
```

The core design principle is that the system must preserve the difference between **what was observed**, **what was derived**, and **what remains unknown**.

### Market intelligence

EVE Trade collects regional market observations from ESI and preserves the evidence needed to reconstruct them later.

The market layer keeps source provenance, observation time and collection quality explicit. Historical market state is derived from persisted observations rather than replacing them.

### Player intelligence

Authenticated Player data is explicitly scoped to a character.

Market observations remain public data, while wallet, transactions, assets and active orders remain character-scoped observations. Availability, coverage, health and freshness are tracked separately so degraded data is not silently turned into a valid empty state.

### Trading analysis

The analysis layer evaluates trading scenarios against observed market and player state.

It supports deterministic economic simulation with order-book depth, capital, escrow, fees and logistics constraints while remaining **simulation-only**.

The project does not place, modify or cancel EVE orders.

### Opportunity tracking

Detected opportunities can be persisted as time-bound observations with their market evidence and analytical context.

Opportunity identity remains separate from individual market orders and from the character that observed the opportunity. Later outcome evidence is kept separate from the original simulation.

### Prediction

The prediction layer consumes persisted historical observations and outcomes through a deterministic dataset boundary.

The first baseline is deliberately transparent and point-in-time constrained. When historical evidence is insufficient, the system can return `INSUFFICIENT_DATA` rather than manufacture a numerical prediction.

## What the system does not claim

The current repository does **not** claim:

- real order execution;
- guaranteed profitability;
- realized P&L reconstruction beyond what available evidence can establish;
- production-calibrated prediction quality;
- a completed scoring or recommendation engine;
- a deployed public service.

These are either future product capabilities or require evidence that is not yet available.

## Engineering characteristics

EVE Trade v2 is implemented as a pnpm TypeScript monorepo:

- `apps/worker` — background ingestion and analytical processing
- `apps/api` — application API boundary
- `apps/web` — presentation layer
- `packages/contracts` — shared contracts
- `packages/domain` — deterministic business rules
- `packages/esi` — ESI transport and typed clients
- `packages/db` — PostgreSQL persistence
- `database/migrations` — schema history
- `docs` — durable architecture and engineering documentation

The project favors explicit contracts, deterministic reconstruction, provenance and reproducibility over opaque fallbacks.

## Reproducibility

Requirements:

- Node.js 24
- the pnpm version declared by `packageManager`
- PostgreSQL 16 for integration tests

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Validate the repository:

```bash
pnpm typecheck
pnpm test
```

The validation suite is designed without live EVE credentials or live ESI dependency.

## Quality and security

The public repository currently provides:

- GitHub Actions CI for pull requests and `main`;
- PostgreSQL-backed integration validation;
- locked dependency installation;
- TypeScript typechecking;
- the full test suite;
- minimal workflow permissions;
- immutable workflow action references;
- concurrency control for obsolete runs;
- weekly Dependabot maintenance;
- CodeQL analysis.

Dependency Review is present as a repository workflow, with its enforcement dependent on GitHub's Dependency Graph configuration.

The visible CI state is intentionally based on actual repository controls rather than decorative badges or claims.

## Documentation

The durable documentation is intentionally limited to information that remains useful beyond a single implementation chantier:

- [Architecture](docs/architecture.md)
- [Development workflow](docs/development-workflow.md)
- [License](LICENSE)

## Status

EVE Trade v2 is an evolving engineering project. The README describes the **product and its technical boundaries**; implementation history and project management are intentionally kept out of the product-facing entry point.

## License

Released under the [MIT License](LICENSE).
