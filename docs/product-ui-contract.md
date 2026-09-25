# Product UI Contract

The first EVE Trade v2 UI is an explanation surface, not an execution terminal.

## Information hierarchy

The shell follows:

```
what
→ why
→ evidence
→ limitations
```

A user can move from opportunity overview to detail, then inspect score/advice and the evidence behind them.

## Explicit data states

The UI preserves these states:

- COMPLETE
- PARTIAL
- ERROR
- UNKNOWN
- STALE
- ABSENT

They are not interchangeable.

Examples:

- `SCORE_UNAVAILABLE` renders as unavailable, not 0.
- `UNKNOWN` freshness stays unknown.
- `STALE` remains stale even when previous economics were positive.
- `ABSENT` does not render as a successful empty opportunity.
- `PARTIAL` remains visually distinguishable from COMPLETE.

## Scoring presentation

The score is presented together with:

- availability;
- advice;
- score reasons;
- blockers;
- limitations;
- prediction status;
- evidence references;
- provenance/scope.

The UI does not present a bare numeric score as a guaranteed profit signal.

## Source boundary

The browser consumes the API contract only:

```
API → Web
```

It does not query:

- ESI;
- PostgreSQL;
- domain repositories.

No EVE token is stored in the browser.

## Phase 8 scope

The shell is intentionally read-only. Buttons and navigation must not imply order placement, modification, cancellation or automatic capital allocation.


## Phase 8.1 pipeline state

The opportunity surface consumes the API's `data.pipeline` state to explain an empty or degraded result.

The Web surface keeps these cases distinct:

- no pipeline run yet: the opportunity surface has not been populated by the worker;
- `NO_CANDIDATES`: the latest complete market evidence contained no eligible candidate;
- `INPUT_UNAVAILABLE`: required evidence was incomplete or non-comparable;
- `ERROR`: the latest pipeline execution failed;
- `SUCCESS`: persisted opportunity observations may be displayed normally.

The pipeline state never creates a card. Opportunity cards exist only when the API returns persisted observations from the tracking read model.

## Production data boundary

Phase 8.1 does not use browser fixtures, seeded demonstration opportunities or UI-only fallback values as production data. The only production path is:

```
ESI market evidence
→ canonical state/history
→ candidate generation
→ TradeAnalysis
→ OpportunityObservation
→ PostgreSQL
→ API
→ Web
```
