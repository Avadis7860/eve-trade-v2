#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/eve_trade_v2}"
HOST="${HOST:-0.0.0.0}"
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-3001}"
LOG_DIR="$ROOT_DIR/.codespaces"
API_PID=""
WEB_PID=""

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

cleanup() {
  set +e
  for pid in "$API_PID" "$WEB_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$LOG_DIR/api.pid" "$LOG_DIR/web.pid"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$LOG_DIR"
[[ ! -f "$LOG_DIR/api.pid" || ! -d "/proc/$(cat "$LOG_DIR/api.pid")" ]] || die "an API process is already running"
[[ ! -f "$LOG_DIR/web.pid" || ! -d "/proc/$(cat "$LOG_DIR/web.pid")" ]] || die "a Web process is already running"
rm -f "$LOG_DIR/api.pid" "$LOG_DIR/web.pid"

command -v node >/dev/null 2>&1 || die "Node.js is not installed"
command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed"
command -v psql >/dev/null 2>&1 || die "PostgreSQL client (psql) is not installed"
command -v curl >/dev/null 2>&1 || die "curl is not installed"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" == "24" ]] || die "Node.js 24 is required; found $(node --version)"
pnpm_version="$(pnpm --version)"
[[ "$pnpm_version" == "10.15.0" ]] || die "pnpm 10.15.0 is required; found $pnpm_version"

printf 'Node 24           OK\n'
printf 'pnpm 10.15.0      OK\n'

for _ in $(seq 1 30); do
  psql "$DATABASE_URL" -Atqc "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
psql "$DATABASE_URL" -Atqc "SELECT 1" >/dev/null 2>&1 || die "PostgreSQL is not reachable"

server_version_num="$(psql "$DATABASE_URL" -Atqc "SHOW server_version_num")"
[[ "$server_version_num" == 16* ]] || die "PostgreSQL 16 is required; found $server_version_num"
printf 'PostgreSQL 16     OK\n'

mapfile -t migrations < <(find "$ROOT_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort)
(("${#migrations[@]}" > 0)) || die "no SQL migrations were found"
for migration in "${migrations[@]}"; do
  printf 'Applying migration %s\n' "$(basename "$migration")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" >"$LOG_DIR/migrations.log" 2>&1 || {
    cat "$LOG_DIR/migrations.log" >&2
    die "migration failed: $(basename "$migration")"
  }
done

table_count="$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('market_collections','market_page_observations','canonical_market_states','market_history_snapshots','player_syncs','opportunities','opportunity_observations','opportunity_pipeline_runs')")"
[[ "$table_count" == "8" ]] || die "database validation failed: expected 8 core tables, found $table_count"
printf 'Migrations        OK\n'

API_LOCAL_URL="http://127.0.0.1:$API_PORT"
WEB_LOCAL_URL="http://127.0.0.1:$WEB_PORT"
if [[ "${CODESPACES:-false}" == "true" && -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  API_PUBLIC_URL="https://${CODESPACE_NAME}-$API_PORT.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  WEB_PUBLIC_URL="https://${CODESPACE_NAME}-$WEB_PORT.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  API_PUBLIC_URL="$API_LOCAL_URL"
  WEB_PUBLIC_URL="$WEB_LOCAL_URL"
fi

DATABASE_URL="$DATABASE_URL" HOST="$HOST" PORT="$API_PORT" pnpm --filter @eve-trade/api start >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!
printf '%s\n' "$API_PID" >"$LOG_DIR/api.pid"

api_ready=false
for _ in $(seq 1 30); do
  if health="$(curl -fsS "$API_LOCAL_URL/health" 2>/dev/null)" && grep -Fq '"status":"ok"' <<<"$health"; then
    api_ready=true; break
  fi
  sleep 1
done
[[ "$api_ready" == true ]] || { cat "$LOG_DIR/api.log" >&2 || true; die "API did not become healthy on port $API_PORT"; }
printf 'API :%s         OK\n' "$API_PORT"

API_BASE_URL="$API_PUBLIC_URL" HOST="$HOST" PORT="$WEB_PORT" pnpm --filter @eve-trade/web start >"$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
printf '%s\n' "$WEB_PID" >"$LOG_DIR/web.pid"

web_ready=false
for _ in $(seq 1 30); do
  if curl -fsS "$WEB_LOCAL_URL/" >/dev/null 2>&1; then web_ready=true; break; fi
  sleep 1
done
[[ "$web_ready" == true ]] || { cat "$LOG_DIR/web.log" >&2 || true; die "Web did not become reachable on port $WEB_PORT"; }

runtime_config="$(curl -fsS "$WEB_LOCAL_URL/__runtime-config.js")"
grep -Fq "$API_PUBLIC_URL" <<<"$runtime_config" || die "Web runtime configuration does not point to the forwarded API URL"
html="$(curl -fsS "$WEB_LOCAL_URL/")"
grep -Fq './__runtime-config.js' <<<"$html" || die "Web shell does not load runtime configuration"
grep -Fq './app.js' <<<"$html" || die "Web shell does not load app.js"
cors_headers="$(curl -fsS -D - -o /dev/null -H "Origin: $WEB_PUBLIC_URL" "$API_LOCAL_URL/health")"
grep -Eiq '^access-control-allow-origin:[[:space:]]*\*' <<<"$cors_headers" || die "API CORS does not allow the Web origin"

printf 'Web :%s         OK\n' "$WEB_PORT"
printf 'Worker            SKIPPED\n'
printf 'ESI calls         SKIPPED\n'
printf '\nAPI URL: %s\nWeb URL: %s\n' "$API_PUBLIC_URL" "$WEB_PUBLIC_URL"
printf 'PostgreSQL: internal service postgres:5432 (not forwarded)\n'
printf 'Logs: %s\n' "$LOG_DIR"
printf '\nBootstrap is running. Press Ctrl+C to stop API and Web cleanly.\n'

wait -n "$API_PID" "$WEB_PID" || true
printf 'ERROR: API or Web exited unexpectedly.\n' >&2
exit 1
