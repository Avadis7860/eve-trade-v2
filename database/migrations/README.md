# Migrations

Database schema history for EVE Trade v2.

Phase 1 introduces the first persistence contract. Apply SQL migrations in lexical order.

001_market_ingestion.sql creates:
- collection/checkpoint metadata;
- raw paginated market observations;
- reconstructible canonical market state and orders.

Raw page payloads, response headers, provenance and observation timestamps remain persisted independently of canonical state. Canonical rows are derived and can be rebuilt from stored observations.
