# EVE Trade v2 — Master Plan

## Product objective

Build a market-intelligence platform that continuously collects EVE Online market data, reconstructs the player's financial and trading state, identifies executable inter-regional opportunities, records their outcomes, and later produces predictions and scored advice.

## Delivery model

The master plan is the product-level dependency map. GitHub Issues are the executable work units.

Rules:
- one active development phase at a time;
- one active working branch;
- one active pull request;
- each phase has explicit entry and exit criteria;
- no phase starts before its predecessor is merged and validated;
- downstream work consumes stable upstream contracts.

## Phases

### Phase 0 — Foundation
Repository structure, package boundaries, development conventions and baseline tooling.

### Phase 1 — Market ingestion
Complete regional market-order collection with pagination, caching/rate-limit awareness, provenance and observation timestamps.

### Phase 2 — Market history
Normalize persisted Phase 1 market collections into a deterministic, reconstructible historical layer for price, spread, depth and observable liquidity analysis.

Phase 2 keeps observation time separate from semantic market state:
- `observed_at` identifies when EVE Trade collected the collection;
- ESI `Last-Modified` and `X-Compatibility-Date` remain source metadata;
- complete comparable collections receive a deterministic `state_fingerprint`;
- identical fingerprints are repeated observations, while a later return to a former fingerprint remains a new occurrence;
- PARTIAL, ERROR and UNKNOWN collections never create a complete comparable snapshot;
- order changes are observational (APPEARED, UNCHANGED, MODIFIED, DISAPPEARED) and never imply filled/cancelled/expired causes;
- price, spread, depth and visible-liquidity metrics are derived only from the canonical order book;
- derived history tables are rebuildable from Phase 1 persisted observations.

### Phase 3 — Player data
Synchronize characters and financial/trading data: wallet, journal, transactions, assets and active orders, with explicit scope and provenance.

### Phase 4 — Trade analysis
Evaluate executable inter-regional opportunities using order-book depth, capital, fees, logistics and configurable constraints.

### Phase 5 — Opportunity tracking
Persist detected opportunities, market evolution and outcomes so the system has a historical learning dataset.

### Phase 6 — Prediction
Train and run models against historical opportunities to estimate persistence, liquidity, spread evolution and execution-related outcomes.

### Phase 7 — Scoring and advice
Combine deterministic economics with prediction outputs into transparent opportunity scores and actionable advice.

### Phase 8 — API and product UI
Expose canonical and analytical models through the API and build the user workflow around market intelligence, player state, opportunities and predictions.

### Phase 9 — Hardening
Observability, data quality checks, backfills, recovery, performance, security and operational safeguards.

## Dependency graph

Foundation
  -> Market ingestion
  -> Market history
  -> Player data
  -> Trade analysis
  -> Opportunity tracking
  -> Prediction
  -> Scoring / advice
  -> API / UI
  -> Hardening

Market history and player state are independent data sources after their persistence contracts are stable. Trade analysis depends on both. Prediction depends on recorded analytical outcomes.

## Issue strategy

The issue tracker mirrors the phases without creating speculative implementation tickets in advance.

At the start of a phase, its issue defines objective, scope, upstream contracts, non-goals, implementation tasks, validation evidence and exit criteria.

The master-plan issue is the navigation point. Phase issues are execution points. New issues are created only for work that genuinely needs independent tracking or when explicitly requested.
