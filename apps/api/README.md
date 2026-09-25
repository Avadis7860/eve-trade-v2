# EVE Trade v2 API

The API is the read-only application boundary between persisted/domain evidence and product clients.

## Runtime

The server requires:

```
DATABASE_URL=postgresql://...
PORT=3000
HOST=0.0.0.0
```

Only `DATABASE_URL` is mandatory. The API does not accept or expose EVE credentials.

Run locally with:

```
pnpm --filter @eve-trade/api dev
```

## Read contract

Version: `phase-08.1`

Public routes:

- `GET /health`
- `GET /api/v1/opportunities`
- `GET /api/v1/opportunities/:opportunityId`

The API composes persisted opportunity observations with the deterministic scoring domain function. It does not duplicate scoring rules.

The default read scope is `PUBLIC`. CHARACTER and CORPORATION data require an explicit authorized scope policy supplied by the application host.

Transport errors are represented separately from business states. An unavailable opportunity, stale evidence or an unavailable score remains a domain/data state; it is never replaced with a zero-value success response.

The API is intentionally read-only in Phase 8. There are no order placement, modification or cancellation routes.
