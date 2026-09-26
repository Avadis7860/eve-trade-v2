# EVE Trade v2 — Phase 08.3 Economic Model

## Purpose

Phase 08.3 separates market intelligence, trade simulation, economic operations and portfolio state.

The system distinguishes:

```
Market Snapshot
    ↓
Market Opportunity
    ↓
Trade Scenario (simulation)
    ↓
Economic Operation
    ↓
Position
    ↓
Portfolio
```

No layer is allowed to infer execution or ownership from another layer without explicit evidence.

## Trade Scenario

A `TradeScenario` is a deterministic simulation input. Existing `TAKER_AGAINST_SELL` and `TAKER_AGAINST_BUY` analysis remains the reusable market-book simulator.

Two candidate strategies are supported explicitly:

- `MARKET_TO_MARKET`: buy against visible sell liquidity, then simulate a taker sale against visible buy liquidity.
- `BUY_AND_RELIST`: buy against visible sell liquidity, then project a maker sell at a later visible sell level.

The production opportunity worker uses `BUY_AND_RELIST` because this represents the common acquire-and-relist workflow without pretending that a future maker order has filled.

The existing taker simulator may cross multiple visible price levels. Book price and settlement price remain distinct concepts:

- book price describes the observed order level;
- settlement price describes the simulated taker limit used by the scenario.

A `MAKER_SELL` disposition is a projection concept, not a fill. Its leg contains no simulated fills or disposition order IDs. Projected proceeds, fees and return are exposed separately from observed/simulated execution economics.

## Opportunity → Economic Operation integration

A valid `BUY_AND_RELIST` opportunity can create a planned economic operation in the worker pipeline. This does not create execution evidence.

The integration boundary is:

```
Market Snapshot
    ↓
BUY_AND_RELIST TradeScenario
    ↓
TradeAnalysis (observed acquisition liquidity + projected maker sell)
    ↓
OpportunityObservation
    ↓
EconomicOperation (ACQUISITION_PLANNED)
```

The planned operation records public market provenance and a stable operation identity derived from the opportunity identity. At this stage:

- `acquired_quantity = 0`;
- no acquisition evidence is fabricated;
- `remaining_quantity = 0` because no quantity has yet been observed as acquired;
- later observed acquisition evidence must explicitly call the economic-operation observation API/domain boundary.

The worker therefore persists a plan, not a claim that an order was placed or filled.

## Economic Operation

An `EconomicOperation` has an identity independent of:

- the market opportunity;
- any `order_id`;
- an order issuer;
- the observing character;
- a particular market snapshot.

Operation evidence is append-oriented and can contain transactions, orders, journals, assets and market snapshots with explicit provenance.

The operation tracks global quantity:

```
initial
  acquired
  disposed
  remaining
```

The quantity equation is:

```
remaining_quantity = acquired_quantity - disposed_quantity
```

Disposition may never exceed the acquired quantity.

## Lifecycle

The current deterministic lifecycle is:

```
DETECTED
    ↓
ACQUISITION_PLANNED
    ↓
ACQUIRED
    ↓
OPEN
    ↓
PARTIALLY_DISPOSED
    ↓
COMPLETED
```

`ACQUIRED` represents an operation for which some quantity has been observed as acquired but the full requested quantity is not yet acquired.

Lifecycle is based on explicit operation quantities and evidence. It is not closed because:

- a market order disappeared;
- a new market snapshot arrived;
- a best price changed;
- a score changed;
- a prediction changed.

## Economic evaluation

Three result concepts are exposed separately:

- `observed_sub_result`: result for documented disposed units where explicit acquisition cost basis, proceeds, fees and logistics are available;
- `observed_current_result`: current observed result for the complete operation quantity and currently known cash flows;
- `projected_current_result`: a separate projection using an explicit projected disposition;
- `terminal_result`: available only when the operation is fully disposed and the current observed result is economically complete.

The model does not introduce FIFO or a hidden accounting ledger.

A positive sub-result does not close an incomplete operation.

Example:

```
10,000 acquired
1 disposed
9,999 remaining
```

The disposed unit may have a positive sub-result while the operation remains `PARTIALLY_DISPOSED` and has no terminal result.

Unknown cost, fees or logistics stay unknown. They are not converted to zero.

## Position boundary

A `Position` is a derived view of the remaining quantity of an economic operation.

```
position.quantity =
  acquired_quantity - disposed_quantity
```

An operation can also have an unacquired portion (`initial_quantity - acquired_quantity`); this is distinct from the remaining open position (`acquired_quantity - disposed_quantity`). Closing a position is therefore a consequence of the operation lifecycle and explicit quantities, not an interpretation of market-order disappearance.

The position identity is derived from the operation identity but remains a separate read-model concept.

## Portfolio boundary

Phase 08.3 defines the contract boundary for a future portfolio layer:

```
EconomicOperation → Position → Portfolio
```

The portfolio is expected to aggregate:

- cash;
- inventory value;
- open-order exposure;
- committed capital;
- position count;
- concentration;
- duration;
- return/velocity context.

Phase 08.3 does not introduce a complete accounting system.

## Market intelligence

The first reusable intelligence functions are deterministic and evidence-bound.

### Liquidity / depth

Current visible book data can expose:

- visible supply;
- visible demand;
- depth across a bounded number of price levels;
- requested-quantity coverage.

This is visible liquidity only. It is not a guarantee of future supply or maker-order execution. Candidate depth is bounded to preserve deterministic complexity.

For `BUY_AND_RELIST`, the maker target is a policy-derived reference price from later visible sell depth. It is a scenario input, not a prediction of fill probability or time-to-fill.

### Trade-day coverage

When a reference daily traded quantity exists:

```
visible quantity / reference daily quantity
    = trade-day coverage
```

This is a liquidity-coverage metric. It is not a guaranteed depletion time.

Missing reference volume remains `UNKNOWN`; invalid reference volume is `ERROR`; partial inputs remain `PARTIAL`.

### Historical price position

The historical layer can derive:

- historical minimum and maximum;
- percentile;
- range position;
- recent change;
- simple volatility;
- descriptive range regime.

A low/high range or a breakout is descriptive market context. It is not a buy or sell recommendation.

### Book anomalies

The anomaly foundation compares complete snapshots and records:

- baseline snapshot;
- comparison snapshot;
- method;
- comparison basis;
- explicit provenance.

Examples include supply collapse, demand surge, liquidity drain and price gap.

An anomaly is an observed change in the book. It does not imply manipulation, actor intent or a guaranteed future move.

## Provenance and scope

All operation and intelligence outputs preserve source provenance and scope.

The following remain distinct:

```
PUBLIC
CHARACTER
CORPORATION
```

The observer is not automatically the owner of public liquidity.

Order issuer is evidence metadata, not an operation-owner field.

## Prediction and scoring

Prediction remains a separate analytical layer. Scoring remains a separate decision-aid layer.

```
Opportunity / Scenario
      ↓
Prediction
      ↓
Scoring
      ↓
Advice
```

None of these layers changes the operation lifecycle or creates execution evidence.

The current API can expose scoring for opportunities and explicit operation state separately. Live prediction persistence is not fabricated where no measured prediction artifact exists.

## Persistence semantics

Economic-operation parent metadata is immutable once an `operation_id` exists. Re-submitting the same operation is idempotent for the observation identity; changing the operation state creates a new historical observation rather than mutating the parent row.

An operation observation is the historical source for the current materialized state:

```
operation_id
    ↓
immutable operation identity
    +
append-only observations
    ↓
latest observed operation state
```

A conflicting re-use of an existing `operation_id` with different identity metadata is rejected rather than silently overwritten.

## Reuse policy

Phase 08.3 reuses existing:

- ESI market observations;
- canonical market state;
- persisted market depth/history;
- TradeAnalysis;
- OpportunityTracking;
- Prediction;
- Scoring.

No new ESI source is introduced only to satisfy this phase.

## Explicit limitations

The following remain outside the implemented economic truth:

- real order placement or cancellation;
- unobserved fills;
- hidden order-book liquidity;
- guaranteed future supply/demand;
- FIFO/accounting ledger semantics;
- causal claims about market moves;
- complete portfolio accounting;
- production-calibrated prediction quality.


## Production configuration

The market worker's Phase 08.3 production path uses `BUY_AND_RELIST`. Broker-fee configuration is read from `BROKER_FEE_RATE`; sales tax continues to come from `SALES_TAX_RATE`. Missing fee inputs remain explicit and block a complete projected economic result rather than becoming zero.

The default domain candidate policy remains `MARKET_TO_MARKET` so the generic candidate generator remains backwards-compatible; production behavior is selected explicitly by the worker configuration.
