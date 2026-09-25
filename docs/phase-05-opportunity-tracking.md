# Phase 5 — Opportunity Tracking

## Contract

Phase 5 turns a Phase 4 trade analysis into a persistent observation without changing the analytical result.

The persistent model has three distinct levels:
- **opportunity identity**: deterministic identity of the economic scenario;
- **opportunity observation**: time-bound observation containing the Phase 4 result and its evidence;
- **outcome**: independent evidence about what was later observed.

The Phase 4 `scenario_fingerprint` remains an analytical evidence fingerprint. It is deliberately not reused as the persistent opportunity identity because Phase 4 fingerprints include time, source snapshots and analysis configuration.

## Opportunity identity

The identity is derived only from the stable scenario definition:
- item type and requested quantity;
- acquisition source;
- acquisition execution mode, location, limit price and range when acquisition is market-based;
- disposition execution mode, location, limit price and range;
- origin and destination.

Player-specific asset IDs and inventory cost basis are not part of the identity. They are evidence/context for a given observation.

The identity does not contain:
- market snapshot IDs;
- market order IDs;
- observation timestamp;
- `as_of`;
- observing character;
- corporation scope;
- instantaneous Phase 4 economics.

This keeps a semantic scenario stable while its observed market conditions evolve.

## Observation semantics

An observation retains the original Phase 4 scenario and result together with:
- the Phase 4 contract version and analytical fingerprint;
- market snapshot and order IDs used as evidence;
- provenance;
- explicit observation scope;
- presence (`PRESENT`, `ABSENT`, `UNAVAILABLE`);
- freshness state (`CURRENT`, `STALE`, `UNKNOWN`);
- observation timestamp.

`ABSENT` means the caller has evidence that the opportunity was not present in the evaluated dataset. `UNAVAILABLE` means the evidence was insufficient to establish presence. The model does not infer either state from a generic Phase 4 failure.

Observation IDs are deterministic and include the observation scope, so two characters observing the same opportunity at the same time cannot overwrite one another.

## Temporal reconstruction

History is rebuilt from persisted observations. Observations are partitioned by opportunity and principal scope before comparison.

Within one observation stream:
- first observation → `INITIAL`;
- `PRESENT` → `PRESENT` with a higher simulated net result → `IMPROVED`;
- lower simulated net result → `DETERIORATED`;
- unchanged comparable economics → `MAINTAINED`;
- loss of comparable proof → `PROOF_LOST`;
- `PRESENT` → `ABSENT` → `DISAPPEARED`;
- absence/unavailability → `PRESENT` → `RETURNED`.

These are observational relations. No cause such as filled, cancelled or expired is inferred.

## Outcome semantics

Outcomes are stored independently of Phase 4 simulations.

An outcome can carry evidence from transactions, orders, journal or assets with their own source provenance. The operation-level state is based on an explicit observed quantity and evidence coverage.

A partial quantity remains `PARTIALLY_OBSERVED`; it is never promoted to `COMPLETELY_OBSERVED`. A complete operation outcome requires observed quantity to cover the expected operation quantity. Missing or insufficient evidence remains `UNKNOWN` rather than becoming zero.

Phase 5 does not calculate a financial truth from these outcomes and does not infer causality between a transaction and a market opportunity unless a later evidence-matching contract establishes that link.

## Persistence

Migration `004_opportunity_tracking.sql` adds:
- `opportunities` — stable scenario identity;
- `opportunity_observations` — append-oriented Phase 4 observation history;
- `opportunity_outcomes` — independent observed outcome evidence.

The observation and outcome identifiers are primary keys, making caller-produced deterministic IDs idempotent. Retrieval is indexed by opportunity/time and item type/time.

All Phase 5 records preserve the underlying JSON contract alongside normalized lookup fields, allowing future rebuilds without losing the original analytical payload.

## Boundaries

Phase 5 remains below prediction, scoring, advice, product API and UI.

It consumes Phase 4 results and existing Player/market provenance but introduces no new ESI endpoint or OAuth requirement.