# Phase 4 — Trade analysis foundation

Phase 4 starts from the stable Market History and Player Data contracts and keeps economics in the pure domain layer.

## Locked in this increment

### Settlement is separate from observed book price

For `TAKER_AGAINST_SELL`, CCP documents that the buyer's requested price is the settlement price when immediate matching occurs. For `TAKER_AGAINST_BUY`, the seller's requested price is the settlement price. The domain therefore stores both:

- `book_price`: observed counterparty order price;
- `settlement_price`: deterministic simulated transaction price.

The engine never treats a book price as a realized execution.

### Deterministic simulation convention

CCP does not guarantee that a player can choose which equal-price order will be matched. Phase 4 uses ascending `order_id` as a reproducibility-only tie-break when prices are equal. This is a simulation convention, not an execution guarantee.

### Range semantics

ESI exposes market-order ranges as `station`, `solarsystem`, `region` or jump-count values `1,2,3,4,5,10,20,30,40`.

The domain can resolve station/system/region compatibility directly. A numeric range requires explicit jump evidence; the engine does not invent a route or jump count.

### Non-fabrication rule

A complete comparable snapshot is required before matching. Unknown range coverage is surfaced as `RANGE_UNKNOWN` / `DATA_UNAVAILABLE` when it blocks the requested fill.

## Not yet implemented in this increment

Capital policy, escrow semantics, inventory cost basis, fees aggregation, logistics completeness, temporal freshness gating and the full `TradeAnalysisRequest -> TradeAnalysisResult` orchestration remain in the same Phase 4 issue and branch. No execution API, persistence of opportunities, or UI is introduced.
