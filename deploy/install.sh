#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/attuno-studio"
UI_DIR="$APP_DIR/ui-prototype"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-$APP_DIR/.venv}"
DATA_DIR="${ATTUNO_STUDIO_DATA_DIR:-/var/lib/attuno}"
RUN_USER="${ATTUNO_RUN_USER:-attuno}"
MIN_NODE_MAJOR="${MIN_NODE_MAJOR:-20}"
SKIP_SYSTEM_PACKAGES="${SKIP_SYSTEM_PACKAGES:-0}"

log() {
  printf '[attuno-install] %s\n' "$*"
}

fail() {
  printf '[attuno-install] ERROR: %s\n' "$*" >&2
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

install_system_packages() {
  if [[ "$SKIP_SYSTEM_PACKAGES" == "1" ]]; then
    log "Skipping apt package installation because SKIP_SYSTEM_PACKAGES=1."
    return
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    log "apt-get not found; skipping Ubuntu package installation."
    return
  fi
  log "Installing Ubuntu packages needed by Attuno..."
  as_root apt-get update
  as_root apt-get install -y git python3 python3-venv python3-pip nginx curl ca-certificates
}

check_node() {
  require_cmd node
  require_cmd npm
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0')"
  if (( major < MIN_NODE_MAJOR )); then
    fail "Node.js >= $MIN_NODE_MAJOR is required. Current: $(node --version 2>/dev/null || printf 'missing'). Install Node.js 20+ and rerun this script."
  fi
}

copy_if_missing() {
  local source="$1"
  local target="$2"
  if [[ -f "$target" ]]; then
    log "Keeping existing $(basename "$target")."
    return
  fi
  cp "$source" "$target"
  log "Created $(basename "$target") from $(basename "$source")."
}

install_python_deps() {
  require_cmd "$PYTHON_BIN"
  require_file "$APP_DIR/requirements.txt"
  log "Preparing Python virtual environment: $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/python" -m pip install -r "$APP_DIR/requirements.txt"
}

install_frontend_deps() {
  require_file "$UI_DIR/package.json"
  log "Installing frontend dependencies..."
  cd "$UI_DIR"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  log "Building frontend..."
  npm run build
}

prepare_runtime_files() {
  require_file "$APP_DIR/.env.example"
  require_file "$APP_DIR/config.example.json"
  copy_if_missing "$APP_DIR/.env.example" "$APP_DIR/.env"
  copy_if_missing "$APP_DIR/config.example.json" "$APP_DIR/config.json"

  log "Preparing data directory: $DATA_DIR"
  if [[ "$(id -u)" -eq 0 ]] || command -v sudo >/dev/null 2>&1; then
    as_root mkdir -p "$DATA_DIR"
    as_root chown -R "$RUN_USER:$RUN_USER" "$DATA_DIR" 2>/dev/null || log "Could not chown $DATA_DIR to $RUN_USER; check permissions manually."
  else
    mkdir -p "$DATA_DIR"
  fi
}

main() {
  [[ -d "$APP_DIR" ]] || fail "Cannot find attuno-studio at $APP_DIR"
  [[ -d "$UI_DIR" ]] || fail "Cannot find frontend at $UI_DIR"

  install_system_packages
  check_node
  prepare_runtime_files
  install_python_deps
  install_frontend_deps

  cat <<EOF

[attuno-install] Done.

Next steps on Ubuntu:
  1. Edit server secrets/config:
     $APP_DIR/.env
     $APP_DIR/config.json

  2. Install and start the API service:
     sudo cp $REPO_ROOT/deploy/attuno-api.service.example /etc/systemd/system/attuno-api.service
     sudo sed -i 's#/opt/attuno/PicCreator#$REPO_ROOT#g' /etc/systemd/system/attuno-api.service
     sudo systemctl daemon-reload
     sudo systemctl enable --now attuno-api

  3. Install Nginx site config:
     sudo cp $REPO_ROOT/deploy/nginx.attuno.conf.example /etc/nginx/sites-available/attuno
     sudo sed -i 's#/opt/attuno/PicCreator#$REPO_ROOT#g' /etc/nginx/sites-available/attuno
     sudo ln -sfn /etc/nginx/sites-available/attuno /etc/nginx/sites-enabled/attuno
     sudo nginx -t && sudo systemctl reload nginx

  4. Future updates:
     cd $REPO_ROOT && bash deploy/update.sh
EOF
}

main "$@"
