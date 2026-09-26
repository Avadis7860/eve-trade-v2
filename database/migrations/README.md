# Migrations

Database schema history for EVE Trade v2.

Apply SQL migrations in lexical order.

The Codespaces bootstrap applies every database/migrations/*.sql file in lexical order with psql and ON_ERROR_STOP. The existing migrations are idempotent DDL, so rerunning the bootstrap does not need a separate migration ledger or development-only schema.

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

003_player_data.sql creates:
- character-scoped Player sync collections;
- append-only Player observations;
- explicit Player component quality state;
- character principal metadata;
- typed current wallet, journal, transaction, asset and active-order state.

Player current tables are derived from complete observations. A PARTIAL/ERROR/UNKNOWN component does not delete or replace the last complete canonical rows; its quality state remains explicit.

Player observations retain raw payload, provenance, endpoint/page identity, observation timestamp, HTTP status, retry count and cache/rate-limit metadata. No credential field is persisted.

004_opportunity_tracking.sql creates:
- stable persisted opportunity identities;
- append-oriented Phase 4 opportunity observations with scope and provenance;
- independently persisted outcome evidence and status;
- indexes for opportunity/time and type/time history.

The Phase 5 tables preserve the original scenario and Phase 4 analytical payload so derived history can be reconstructed without introducing a new external source.
007_economic_operations.sql creates:
- independent EconomicOperation identities;
- append-only operation observations with lifecycle, quantity, result, evidence, scope and provenance;
- indexes for operation/opportunity and operation history.

Operation observations are derived/persisted state and do not represent order execution unless their explicit evidence proves it.


008_economic_operation_immutability.sql creates:
- database-level immutability triggers for economic operation identities;
- database-level immutability triggers for economic operation observations.

The operation history can therefore only advance by inserting a new observation. UPDATE/DELETE attempts are rejected by PostgreSQL.
