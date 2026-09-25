# EVE Trade v2

[![CI](https://github.com/Avadis7860/eve-trade-v2/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Avadis7860/eve-trade-v2/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Avadis7860/eve-trade-v2/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/Avadis7860/eve-trade-v2/security/code-scanning)

EVE Trade v2 is a **market-intelligence and trading-analysis platform for EVE Online**.

The project is being built as a reproducible data and analysis pipeline:

```
EVE / ESI
   ↓
raw observations
   ↓
canonical state
   ↓
market history + player state
   ↓
deterministic trade analysis
   ↓
opportunity history
   ↓
prediction
   ↓
scoring / advice
   ↓
API / product UI
```

The repository is intentionally developed in dependency order. Each phase establishes a stable contract consumed by the next one.

## Current status

The public repository currently contains the implemented foundations through **Phase 6 — Prediction**.

| Phase | Status | What is actually delivered |
| --- | --- | --- |
| 0 — Foundation | ✅ Delivered | Monorepo architecture, package boundaries and development conventions |
| 1 — Market ingestion | ✅ Delivered | Regional ESI market collection, persistence, pagination, provenance and reconstruction |
| 2 — Market history | ✅ Delivered | Deterministic historical market reconstruction from persisted observations |
| 3 — Player data | ✅ Delivered | Character-scoped wallet, journal, transactions, assets and active orders |
| 4 — Trade analysis | ✅ Delivered | Deterministic, simulation-only economic analysis |
| 5 — Opportunity tracking | ✅ Delivered | Persistent opportunity observations and independently evidenced outcomes |
| 6 — Prediction | ✅ Delivered | Point-in-time dataset materialization and transparent empirical baseline |
| 7 — Scoring & advice | Planned | Not implemented yet |
| 8 — API & product UI | Planned | Not implemented as the product layer |
| 9 — Hardening | Planned | Operational and production hardening |

**Planned does not mean implemented.** The roadmap is documented separately in the [Master Plan](docs/master-plan.md).

## What is technically demonstrated

### Market data with provenance

Phase 1 treats ESI as an external source and persists raw observations with timestamps and response metadata before deriving canonical state.

The ingestion boundary handles the realities of ESI collection such as pagination, caching/rate-limit metadata, retries and incomplete collections.

### Reconstructible market history

Phase 2 derives historical market state exclusively from persisted Phase 1 observations.

Raw observations remain the reconstruction source. Derived history does not replace them.

Market changes are observational: an order can appear, remain unchanged, be modified or disappear without the system inventing a cause such as `FILLED`, `CANCELLED` or `EXPIRED`.

### Character-scoped Player data

Authenticated ESI observations are explicitly bound to a character principal.

The project keeps **PUBLIC market data** separate from **CHARACTER-scoped Player data**, and preserves availability, coverage, health and freshness as distinct concepts.

### Deterministic trade analysis

Phase 4 evaluates trading scenarios against persisted market and player contracts.

The analysis can include order-book depth, capital, escrow, fees and logistics constraints while remaining **simulation-only**.

It does not place, modify or cancel EVE orders and does not claim realized P&L.

### Opportunity history

Phase 5 turns analytical opportunities into persistent, append-oriented history.

Opportunity identity is kept distinct from market snapshots, individual `order_id` values and the observing character. Outcomes are stored separately from the Phase 4 simulation result, so partial evidence does not become a fabricated complete realization.

### Point-in-time prediction

Phase 6 builds a deterministic prediction dataset from persisted observations and outcomes.

The dataset is explicitly protected against future-data leakage. The initial model is an empirical baseline rather than an opaque machine-learning dependency, and insufficient historical evidence produces `INSUFFICIENT_DATA` instead of a synthetic prediction.

## Architecture

The repository is a pnpm monorepo:

- `apps/worker` — background ingestion, analysis and prediction orchestration
- `apps/api` — application API boundary
- `apps/web` — presentation layer
- `packages/contracts` — stable shared contracts
- `packages/domain` — pure deterministic business rules
- `packages/esi` — ESI HTTP transport and typed clients
- `packages/db` — PostgreSQL persistence
- `database/migrations` — schema history
- `docs` — architecture, phases, roadmap and development rules

See [Architecture](docs/architecture.md) for the complete boundary model.

## Data semantics

The project deliberately distinguishes:

- **FACT** — an observation or other persisted evidence
- **DERIVED** — a deterministic result reconstructed from facts
- **AGGREGATED** — a rebuildable historical or analytical aggregation
- **PLANNED** — a roadmap item that is not yet delivered
- **LIMITATION** — a boundary where available data does not justify a stronger conclusion

Several safeguards are intentionally enforced across phases:

- `UNKNOWN`, `PARTIAL`, `ERROR` and `ABSENT` do not become zeroes or valid empty business states;
- source provenance and principal scope remain explicit;
- observed market state is not treated as realized financial truth;
- simulated economics remain simulated until separate evidence establishes an outcome;
- missing evidence is not replaced by invented precision.

## Local validation

Requirements:

- Node.js 24
- the pnpm version declared by `packageManager`
- PostgreSQL 16 for integration tests

Install dependencies with the lockfile:

```bash
pnpm install --frozen-lockfile
```

Run the main validation suite:

```bash
pnpm typecheck
pnpm test
```

The tests are designed to run without live EVE credentials or live ESI calls.

## CI and security posture

The repository currently exposes:

- **CI** on pull requests targeting `main` and on pushes to `main`;
- PostgreSQL 16 integration coverage;
- locked dependency installation;
- TypeScript typechecking;
- the full test suite;
- minimal GitHub Actions permissions;
- immutable action references;
- concurrency cancellation for obsolete runs;
- weekly Dependabot maintenance;
- CodeQL analysis.

The repository also contains a Dependency Review workflow. Its enforcement status depends on the GitHub repository Dependency Graph being enabled; the project documents this explicitly rather than claiming a stronger control than GitHub currently provides.

See [OPS-001](https://github.com/Avadis7860/eve-trade-v2/issues/11) for the repository automation and security governance history.

## Documentation

Start here:

- [Architecture](docs/architecture.md)
- [Master Plan](docs/master-plan.md)
- [Development workflow](docs/development-workflow.md)
- [Phase 4 — Trade analysis](docs/phase-04-trade-analysis.md)
- [Phase 5 — Opportunity tracking](docs/phase-05-opportunity-tracking.md)
- [Phase 6 — Prediction](docs/phase-06-prediction.md)

The GitHub issue tracker is the execution record for the project:

- [MP-001 — Master Plan](https://github.com/Avadis7860/eve-trade-v2/issues/1)
- [OPS-001 — GitHub Actions / security / governance](https://github.com/Avadis7860/eve-trade-v2/issues/11)
- [OPS-002 — Public credibility](https://github.com/Avadis7860/eve-trade-v2/issues/19)

## Scope and current limitations

EVE Trade v2 is an evolving engineering project.

The public repository does **not** currently claim:

- real order execution;
- guaranteed profitability;
- realized P&L reconstruction beyond what the available evidence proves;
- production-calibrated prediction quality;
- a completed recommendation engine;
- a completed product UI;
- a deployed public service.

Those capabilities belong to later phases or require evidence that does not yet exist.

## Repository governance

The project advances one technical chantier at a time:

```
ONE active issue
ONE working branch
ONE pull request
```

Changes are validated by CI before merge and `main` is revalidated after merge.

For the implementation rules, see [Development workflow](docs/development-workflow.md).

## License

Released under the [MIT License](LICENSE).
