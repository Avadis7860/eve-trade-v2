# EVE Trade v2 Web

The Web app is a presentation client for the Phase 8 API contract.

## Runtime

The local shell defaults to:

- Web: `http://localhost:3001`
- API: `http://localhost:3000`

The API base may be overridden with `window.EVE_TRADE_API_BASE` before loading `app.js`.

Run locally with:

```
pnpm --filter @eve-trade/web dev
```

The browser does not call ESI and does not contain EVE credentials. It only consumes the versioned API.

## Codespaces

The Codespaces bootstrap starts the Web on port 3001.

Forwarded Codespaces ports use a Codespace-specific HTTPS domain rather than the developer's local localhost. The Web therefore receives API_BASE_URL at startup and exposes it through /__runtime-config.js before loading app.js.

This keeps the forwarded API address out of hardcoded client configuration. The browser calls only the API; it never calls ESI and never contains EVE credentials.

Use the forwarded Web port for the product shell. The API port can be opened separately for GET /health.

## Product flow

The first shell is:

```
overview
  -> opportunity detail
  -> score / advice
  -> evidence / limitations
```

The UI keeps `COMPLETE`, `PARTIAL`, `ERROR`, `UNKNOWN`, `STALE` and `ABSENT` visible rather than treating them as an empty-success fallback.

Phase 8 is read-only. There are no order execution controls.
