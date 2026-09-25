# Migrations

Database schema history for EVE Trade v2.

Apply SQL migrations in lexical order.

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
