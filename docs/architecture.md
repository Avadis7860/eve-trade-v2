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
    scoring & recommendation
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

Build in dependency order: ingestion -> persistence/history -> player state -> trade analysis -> opportunity history -> prediction -> scoring -> recommendation -> API/UI.

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

## Phase 3 — Player collection integrity

Authenticated Player observations are bound at the database level to the exact `(collection_id, character_id)` pair of their synchronization. This prevents an observation for one character from being attached to another character's synchronization collection.

The ESI transport pins a compatibility date by default rather than deriving it from wall-clock time. Failed ESI requests retain their final response status, retry count, request metadata and cache/rate-limit headers at the Player observation boundary, so degraded collections remain reconstructible with their collection evidence.

## Phase 5 — Opportunity tracking

Opportunity tracking separates three layers:
- deterministic opportunity identity for the stable economic scenario;
- append-oriented observations that retain Phase 4 analysis, market evidence, provenance, scope, freshness and timestamp;
- independent outcome evidence from Player Data.

The Phase 4 scenario fingerprint is evidence about one analysis execution and is not reused as the persistent opportunity identity because it contains time/source/configuration inputs.

Observation history is reconstructed per opportunity and principal scope. This prevents observations made by different characters or scopes from being implicitly merged while preserving one shared economic scenario identity.

Outcome state is never inferred from the disappearance of an opportunity or from a partial transaction. Phase 5 stores explicit evidence and quantity coverage; prediction and scoring remain downstream.

## Phase 6 — Prediction

Prediction consumes only persisted Phase 5 analytical records. The dataset materializer is deterministic and point-in-time correct:

```
Phase 5 observations + outcomes
          |
          v
prediction dataset
  |       |        |
  |       |        +--> explicit scope/provenance
  |       +-----------> future labels only
  +-------------------> features from t and prior data
          |
          v
temporal holdout
          |
          v
transparent baseline
          |
          v
measured evaluation / traceable inference
```

The first model is an empirical rate baseline rather than an opaque ML dependency. A dataset below the declared minimum labeled sample threshold yields `INSUFFICIENT_DATA` instead of a synthetic prediction. The evaluation split excludes a stream that crosses the train/evaluation boundary so one opportunity/principal trajectory cannot silently appear on both sides.

## Phase 7 — Scoring & advice

Phase 7 consumes the explicit Phase 4 trade-analysis result, Phase 5 opportunity evidence and the optional Phase 6 prediction result. It introduces no new ESI or persistence dependency.

The versioned scoring contract is `phase-07.1`; the default scoring policy is `phase-07-policy.1`. The v1 policy is deterministic and fingerprints its complete definition.

The score is bounded to 0–100 and exposes four independent dimensions:

- economics: simulated return normalized from 0 to the declared 10% target;
- executability: the smaller of acquisition/disposition filled-quantity ratios;
- data quality: current complete evidence scores fully, while partial analysis is explicitly reduced;
- prediction signal: optional and used only when the prediction is a measured holdout result with a valid probability.

Default v1 weights are 50% economics, 25% executability, 15% data quality and 10% prediction signal. When the optional prediction is absent or not eligible, the remaining used dimensions are renormalized rather than treating the missing signal as zero.

Stale or unknown freshness blocks the v1 score. Missing simulated economics, unavailable execution evidence, invalid input linkage and other required evidence remain explicit blockers. UNKNOWN/PARTIAL/ERROR/ABSENT information is never silently converted to zero.

Prediction probability, prediction quality and confidence remain separate. In particular, the existing Phase 6 `TRAINING_ONLY` and `INSUFFICIENT_DATA` states do not contribute to the v1 score, and `NOT_ASSESSED` confidence is never inferred by the scoring engine.

Advice is a separate deterministic output with explicit reasons, blockers, limitations and evidence level. Positive simulated economics with full current execution can produce an actionable state; non-positive simulated economics produces `NO_ACTION`; partial execution produces `WATCH`; and insufficient evidence produces `INSUFFICIENT_DATA`. Advice is a decision aid, not a guarantee of realized profit.

The scoring domain is pure, deterministic, testable without HTTP/ESI/PostgreSQL, and reconstructible from the input evidence plus the versioned policy.


## Phase 8.1 — Operational opportunity pipeline

Phase 8.1 closes the production orchestration gap between the persisted market evidence and the Phase 5 opportunity tracking read model.

The operational market cycle is:

```
persisted/canonical market evidence
          |
          v
candidate generation
          |
          v
Phase 4 TradeAnalysis
          |
          v
Phase 5 OpportunityObservation
          |
          v
OpportunityTrackingRepository
          |
          +--------------------+
          |                    |
          v                    v
      Phase 8 API          pipeline status
          |
          v
        Phase 8 Web
```

The Phase 8.1 worker reuses the existing ingestion and market-history layers. It does not introduce a second economic model, scoring engine, execution path or credential flow.

### Root cause of the empty MVP surface

Before Phase 8.1, the market branch of `apps/worker/src/main.ts` stopped after market ingestion. The repository and domain contracts for trade analysis and opportunity tracking already existed, and Phase 8 correctly read persisted opportunity observations, but no operational orchestration invoked the sequence:

```
market state -> candidates -> TradeAnalysis -> OpportunityObservation -> persistence
```

The empty opportunity UI was therefore consistent with an empty tracking read model; it was not evidence that the API or Web surface needed synthetic data.

### Candidate boundary

Phase 8.1 generates only deterministic market-to-market candidates from a complete PUBLIC canonical market snapshot. For each type, the current policy examines the best visible sell and buy prices and creates a candidate only when the visible spread is positive and both sides have remaining volume.

Incomplete or non-public evidence produces no candidate. This is an availability decision, not a numeric zero.

### Operational run state

Each market cycle persists an `OpportunityPipelineRun` with:

- the market region and collection identity;
- observation/completion timestamps;
- candidate, analysis and persistence counts;
- one explicit status: `SUCCESS`, `NO_CANDIDATES`, `INPUT_UNAVAILABLE` or `ERROR`;
- an explicit error payload when execution fails.

The API exposes the latest run state beside the opportunity list so an empty UI can distinguish:

```
no pipeline run
!= no eligible candidates
!= required input unavailable
!= pipeline execution failure
```

This is diagnostic state only; it is not itself an opportunity.

### Evidence and scope

The worker does not invent ownership from the observing character. Public market observations remain PUBLIC and carry their existing ESI provenance. Opportunity observations are created through the Phase 5 domain factory, which preserves the Phase 4 result, market snapshot references, order identifiers, observation scope, provenance and freshness state.

Missing fee or capital configuration remains explicit through the existing Phase 4 analysis contract. The worker does not replace UNKNOWN/UNAVAILABLE inputs with zero values.


## Phase 8.3 — Economic operations and market intelligence

Phase 8.3 introduces a distinct economic lifecycle above the existing market simulation:

```
market intelligence
      ↓
trade scenario (simulation)
      ↓
economic operation
      ↓
position
      ↓
portfolio boundary
```

The existing Phase 4 TradeAnalysis engine remains the reusable deterministic market-book simulator. Phase 8.3 does not create a second order-book simulator. Its taker modes already traverse multiple visible depth levels; a projected `MAKER_SELL` is modeled separately from observed execution and never produces a fill evidence record by itself.

Economic operations have an independent identity. An operation is not keyed by opportunity ID, order ID, order issuer, character or market snapshot. Append-only operation observations persist explicit lifecycle, quantities, result states, evidence, provenance and scope.

The operation quantity equation is:

```
remaining = initial - acquired
```

and disposition cannot exceed the acquired remaining position. The lifecycle is driven by explicit operation quantities/evidence rather than order disappearance or market-score changes.

Economic evaluation separates:
- observed sub-result for explicitly documented disposed units;
- observed current result for the operation as a whole;
- projected current result for an explicit projection;
- terminal result only after full observed disposition and complete economic inputs.

No FIFO or hidden accounting ledger is introduced.

Market intelligence reuses the existing complete canonical order book and persisted history. Depth, visible quantity coverage, trade-day coverage, historical price position, descriptive book anomalies and capital/time velocity are deterministic derivations with explicit status/provenance. Missing values remain UNKNOWN/PARTIAL/ERROR rather than zero. Historical range and anomaly outputs are descriptive evidence, not intent or trading guarantees.

Prediction and scoring remain downstream analytical layers. Neither changes operation state nor manufactures execution evidence. The API exposes opportunities and economic operations through separate read-only contracts.

See `docs/phase-08.3-economic-model.md` for the detailed contract and limitations.
