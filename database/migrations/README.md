# Migrations

Database schema history for EVE Trade v2.

Phase 1 introduces the first persistence contract. Apply SQL migrations in lexical order.

001_market_ingestion.sql creates:
- collection/checkpoint metadata;
- raw paginated market observations;
- reconstructible canonical market state and orders.

Raw page payloads, response headers, provenance and observation timestamps remain persisted independently of canonical state. Canonical rows are derived and can be rebuilt from stored observations.

002_market_history.sql creates:
- historical snapshot identity and source metadata;
- deterministic fingerprint and observation kind;
- derived per-type price/spread/visible-liquidity metrics;
- complete per-price depth levels.

These tables are derived and replaceable. Raw Phase 1 observations remain the reconstruction source.
