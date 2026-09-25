# EVE Trade v2 — Architecture

## System boundary

ESI is an external source, not the internal database.

External ESI
  |
  v
packages/esi + apps/worker
  |
  v
raw observations
  |
  v
canonical persisted state
  |
  +-------------------+
  |                   |
  v                   v
market analysis    player financial state
  |                   |
  +---------+---------+
            v
       trade analysis
            |
            v
      opportunity history
            |
            v
        prediction
            |
            v
       recommendation
            |
            v
           API
            |
            v
           Web

## Application boundaries

### apps/worker

Background processing for market ingestion, normalization, analysis and prediction jobs. Phase 1 places orchestration here while reusable transport, contracts, domain reduction and persistence remain in packages. Phase 3 also exposes a character-scoped Player synchronization entry point that does not require the web UI.

### apps/api

Application-facing API. The UI consumes canonical and analytical data from this boundary and never queries ESI directly.

### apps/web

Presentation layer only. It displays data and status supplied by the API.

### packages/contracts

Stable contracts exchanged between applications and packages. Market and Player contracts explicitly carry availability, source provenance, observation timestamps and raw observations.

### packages/domain

Pure domain models and deterministic reconstruction rules. Player normalization never performs HTTP or database access and never derives trade economics.

### packages/esi

Shared ESI HTTP transport plus typed market and Player clients. The common transport owns User-Agent, compatibility-date, bearer-token injection, retry handling and response metadata capture. Tokens are transport-only.

### packages/db

PostgreSQL access and persistence helpers. Market observations/history and Player observations/canonical state are stored in separate schemas/tables and remain character-scoped where applicable.

## Provenance

`SourceProvenance` distinguishes:
- PUBLIC data with no authenticated principal;
- CHARACTER data bound to an explicit character principal;
- a reserved CORPORATION scope for future work.

Market observations remain PUBLIC. P3 authenticated endpoints require CHARACTER provenance with `principal_id`.

## Persistence layers

### Raw observations

Append-oriented records represent what was observed from ESI. Market observations retain page identity and cache metadata. Player observations retain endpoint/data-kind/page-or-cursor identity, response metadata, raw payload, provenance and error state.

### Canonical state

Canonical records are typed and derived from complete observations. A degraded Player component never replaces its last complete current state, while its quality state explicitly records PARTIAL/ERROR/UNKNOWN.

### Analytical records

Derived records that can be recomputed: market history, trade candidates, opportunities, prediction inputs/results and observed outcomes.

Source observations remain available so derived models can be rebuilt without recollecting the external dataset.

## Player Data boundary

P3 uses:

character principal
  |
  v
credential provider
  |
  v
packages/esi authenticated request
  |
  v
raw Player observation
  |
  v
packages/domain player reconstruction
  |
  v
packages/db canonical Player state

The credential provider is injectable/testable. P3 does not persist refresh tokens. Long-lived authentication requires a secure credential provider outside the observation model.

## Player semantics

- character identity is a public ESI observation plus explicit character principal context;
- wallet balance is a scalar observed state;
- journal is historical ESI journal data and is not automatically profit;
- transactions are execution evidence identified by `transaction_id`;
- assets are an observed inventory state identified by `item_id`;
- active orders are current order records identified by `order_id`.

A transaction is not an active order. A missing active order does not imply FILLED, CANCELLED or EXPIRED without another source proving the cause. An absent Player observation is not a zero value.

## Availability, coverage and health

Player quality tracks three independent dimensions:
- availability: COMPLETE/PARTIAL/ERROR/UNKNOWN for the observation result;
- coverage: COMPLETE/PARTIAL/UNAVAILABLE/UNKNOWN for the collected dataset;
- health: HEALTHY/DEGRADED/FAILED/UNKNOWN for the component condition.

Freshness is represented by observation time and source expiry metadata when supplied; it is not inferred from availability alone.

## Phase 1 consistency rule

ESI currently recommends a compatibility-date header and documents X-Pages pagination for the market orders route and warns that page-cache expiry can cause overlap between pages. ESI also documents that Last-Modified should remain the same across pages of a paginated resource and can be used to validate a coherent retrieval. Therefore Phase 1 does not equate "all HTTP requests returned 200" with "complete canonical snapshot": an inconsistent Last-Modified set produces PARTIAL state, while failed pages produce ERROR state.

## Dependency rule

Build in dependency order: ingestion -> persistence/history -> player state -> trade analysis -> opportunity history -> prediction -> recommendation -> API/UI.

A downstream module consumes explicit upstream contracts. Shortcuts across boundaries require an architectural decision recorded in the repository.

## Phase 2 — Market history

Phase 2 consumes only persisted Phase 1 observations. It does not call ESI and does not replace raw observations or the canonical market state.

The historical layer separates three identities:

- observation occurrence: the Phase 1 `collection_id` and collection `observed_at`;
- semantic market state: deterministic `state_fingerprint` computed from the canonical order set;
- source metadata: effective ESI compatibility date and cache freshness metadata.

A new `observed_at` with the same `state_fingerprint` is an observation repeat, not a market change. If a later collection returns to a previously seen fingerprint, it remains a new historical occurrence.

Only complete, reconstructible collections are eligible for market-state comparison and order lifecycle classification. PARTIAL, ERROR and UNKNOWN collections remain availability records and cannot manufacture missing orders, prices, depth or lifecycle events.

History metrics are derived from the canonical order book and missing sides produce null/unknown metrics rather than zero.

Order evolution is observational only: APPEARED, UNCHANGED, MODIFIED and DISAPPEARED. A disappearance is never interpreted as filled, cancelled or expired without an external source.

The Phase 2 analytical tables are rebuildable caches/indexes. Phase 1 raw observations remain the reconstruction source of truth.
