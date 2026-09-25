# Phase 8.1 — MVP Opportunity Pipeline

## Purpose

Phase 8.1 connects the existing product layers into one operational MVP path:

```
market evidence
→ candidate generation
→ TradeAnalysis
→ OpportunityObservation
→ tracking persistence
→ Phase 8 API
→ Phase 8 Web
```

The phase is an integration/orchestration increment. It does not introduce a new economic engine or execution model.

## Audit conclusion

The Phase 8 API and Web surface were already backed by the opportunity tracking read model, and the Phase 5 repository already persisted `OpportunityObservation` records.

The missing production link was in the market worker:

1. ESI market ingestion produced the canonical market state.
2. Market history could be rebuilt from persisted observations.
3. No production candidate-generation step existed.
4. No production worker step invoked the Phase 4 `TradeAnalysis`.
5. No production worker step created and persisted `OpportunityObservation`.
6. As a consequence, Phase 8 correctly returned an empty opportunity list because the tracking store had no new observations.

This is a pipeline-orchestration gap, not an API/UI fixture problem.

## Operational contract

The Phase 8.1 market worker:

1. ingests the current market region;
2. rebuilds market history from persisted market observations;
3. obtains the matching comparable snapshot;
4. generates deterministic candidates only from COMPLETE PUBLIC market evidence;
5. runs the existing Phase 4 analysis contract;
6. creates the existing Phase 5 observation contract;
7. persists the observation through `OpportunityTrackingRepository`;
8. records a separate operational pipeline-run status.

The run status is diagnostic and does not represent an opportunity by itself.

## Empty-surface diagnosis

The API exposes the latest pipeline run beside the opportunity list.

```
pipeline = null
    → no worker run has populated the tracking pipeline yet

NO_CANDIDATES
    → complete evidence evaluated, zero eligible candidates

INPUT_UNAVAILABLE
    → required evidence incomplete or not comparable

ERROR
    → pipeline execution failed

SUCCESS
    → one or more observations were persisted
```

This prevents an empty product surface from being misread as either a healthy empty market or a generic API failure.

## Evidence rules

Candidate generation requires complete PUBLIC market evidence. The candidate contains only values directly supported by that order book.

Phase 4 remains authoritative for economic analysis. Missing capital, fees, logistics or other required inputs keep the existing status/nullable fields rather than being coerced to zero.

Phase 5 remains authoritative for opportunity identity and observation construction. The worker does not rebuild identity/fingerprint rules and does not infer economic ownership from the observing character.

## Persistence

Opportunity observations continue to use the existing transaction and deterministic identity contract.

The separate pipeline-run record is idempotently upserted by `run_id` and is only operational telemetry/state. It does not replace observation identity, evidence references, provenance, scope or timestamps.

## Validation

The Phase 8.1 tests demonstrate:

- deterministic candidate generation;
- rejection of incomplete/non-public market evidence;
- worker cycle `input → candidate → TradeAnalysis → observation → persistence`;
- explicit partial analysis when fee configuration is missing;
- no observation for zero candidates or unavailable input;
- pipeline-run persistence and idempotent update;
- API exposure of pipeline state;
- Web distinction between an unpopulated pipeline and a true empty opportunity result.

PostgreSQL integration tests apply migrations through `005_opportunity_pipeline_runs.sql`.
