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
