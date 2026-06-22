#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/attuno-studio"
UI_DIR="$APP_DIR/ui-prototype"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-$APP_DIR/.venv}"
SERVICE_NAME="${ATTUNO_SERVICE_NAME:-attuno-api}"
APP_PORT="${APP_PORT:-8787}"
HEALTH_URL="${ATTUNO_HEALTH_URL:-http://127.0.0.1:$APP_PORT/api/health}"
MIN_NODE_MAJOR="${MIN_NODE_MAJOR:-20}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
RESTART_SERVICE="${RESTART_SERVICE:-1}"
RELOAD_NGINX="${RELOAD_NGINX:-1}"

log() {
  printf '[attuno-update] %s\n' "$*"
}

fail() {
  printf '[attuno-update] ERROR: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "Missing required file: $1"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi
  require_cmd sudo
  sudo "$@"
}

check_node() {
  require_cmd node
  require_cmd npm
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0')"
  if (( major < MIN_NODE_MAJOR )); then
    fail "Node.js >= $MIN_NODE_MAJOR is required. Current: $(node --version 2>/dev/null || printf 'missing')."
  fi
}

copy_if_missing() {
  local source="$1"
  local target="$2"
  if [[ -f "$target" ]]; then
    return
  fi
  cp "$source" "$target"
  log "Created missing $(basename "$target") from $(basename "$source")."
}

pull_latest() {
  if [[ "$SKIP_GIT_PULL" == "1" ]]; then
    log "Skipping git pull because SKIP_GIT_PULL=1."
    return
  fi
  if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "Not a Git working tree; skipping git pull."
    return
  fi
  log "Pulling latest code with fast-forward only..."
  git -C "$REPO_ROOT" pull --ff-only
}

install_python_deps() {
  require_cmd "$PYTHON_BIN"
  require_file "$APP_DIR/requirements.txt"
  if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    log "Virtual environment missing; creating $VENV_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
  fi
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/python" -m pip install -r "$APP_DIR/requirements.txt"
}

build_frontend() {
  require_file "$UI_DIR/package.json"
  check_node
  cd "$UI_DIR"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
}

run_database_migrations() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    if [[ "${ATTUNO_ENV:-}" == "production" ]]; then
      fail "ATTUNO_ENV=production requires DATABASE_URL before running update."
    fi
    log "DATABASE_URL is not set; local JSON fallback remains active."
    return
  fi
  log "Running PostgreSQL migrations..."
  cd "$APP_DIR"
  "$VENV_DIR/bin/python" - <<'PY'
from backend.app.services.db import initialize_database

status = initialize_database()
if not status.get("ok"):
    raise SystemExit(status.get("error") or "database initialization failed")
print(status)
PY
}

prepare_runtime_files() {
  require_file "$APP_DIR/.env.example"
  require_file "$APP_DIR/config.example.json"
  copy_if_missing "$APP_DIR/.env.example" "$APP_DIR/.env"
  copy_if_missing "$APP_DIR/config.example.json" "$APP_DIR/config.json"
}

restart_api() {
  if [[ "$RESTART_SERVICE" != "1" ]]; then
    log "Skipping service restart because RESTART_SERVICE=$RESTART_SERVICE."
    return
  fi
  require_cmd systemctl
  log "Restarting systemd service: $SERVICE_NAME"
  as_root systemctl restart "$SERVICE_NAME"
}

check_health() {
  if ! command -v curl >/dev/null 2>&1; then
    log "curl not found; skipping health check."
    return
  fi
  log "Checking API health: $HEALTH_URL"
  for _ in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL" >/dev/null; then
      log "API health check passed."
      return
    fi
    sleep 1
  done
  fail "API did not become healthy at $HEALTH_URL"
}

reload_nginx() {
  if [[ "$RELOAD_NGINX" != "1" ]]; then
    log "Skipping Nginx reload because RELOAD_NGINX=$RELOAD_NGINX."
    return
  fi
  if ! command -v nginx >/dev/null 2>&1; then
    log "nginx not found; skipping reload."
    return
  fi
  log "Testing and reloading Nginx..."
  as_root nginx -t
  as_root systemctl reload nginx
}

main() {
  [[ -d "$APP_DIR" ]] || fail "Cannot find attuno-studio at $APP_DIR"
  [[ -d "$UI_DIR" ]] || fail "Cannot find frontend at $UI_DIR"

  pull_latest
  prepare_runtime_files
  install_python_deps
  run_database_migrations
  build_frontend
  restart_api
  check_health
  reload_nginx

  log "Update complete."
}

main "$@"
