# Worker

Background processing entry point.

The worker can run market ingestion or a character-scoped Player Data synchronization without requiring the web application.

## Market mode

Set:
- `DATABASE_URL`
- `ESI_USER_AGENT`
- `REGION_ID`

## Player mode

Set:
- `DATABASE_URL`
- `ESI_USER_AGENT`
- `PLAYER_CHARACTER_ID`
- `ESI_ACCESS_TOKEN` (optional; absent credentials are represented as UNKNOWN)

The access token is read only at the credential boundary and is never logged or persisted as Player Data. P3 does not persist refresh tokens; a durable implementation must provide a secure credential provider upstream of the worker.
