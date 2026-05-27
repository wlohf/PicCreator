# Deployment Operations

## Scenario: Ubuntu VPS Deployment

### 1. Scope / Trigger

- Trigger: production deployment or update flow for Attuno on Ubuntu VPS.
- Applies when adding or changing deployment scripts, service files, Nginx config, runtime env wiring, or deployment docs.
- Local Windows batch scripts and Vite dev server are development-only entry points.

### 2. Signatures

- First install command: `bash deploy/install.sh`
- Update command: `bash deploy/update.sh`
- API service name: `attuno-api` by default, override with `ATTUNO_SERVICE_NAME`.
- API health endpoint: `GET /api/health`
- Frontend production build command: `npm run build` in `attuno-studio/ui-prototype`.

### 3. Contracts

- Backend process must run from `attuno-studio/`.
- Backend must listen on loopback in production:
  - `APP_HOST=127.0.0.1`
  - `APP_PORT=8787`
- Runtime data must be outside the Git working tree:
  - Preferred: `ATTUNO_STUDIO_DATA_DIR=/var/lib/attuno`
  - Legacy fallback: `RENDER_AGENT_DATA_DIR`
- Nginx serves `attuno-studio/ui-prototype/dist` and reverse-proxies `/api/` to `http://127.0.0.1:8787`.
- Deployment scripts must not overwrite existing `.env` or `config.json`; they may create them from examples when missing.

### 4. Validation & Error Matrix

- Missing `attuno-studio/` or `ui-prototype/` -> fail before installing dependencies.
- Node.js major version below 20 -> fail with an upgrade message before build.
- `git pull --ff-only` conflict -> fail without overwriting server-local changes.
- API service restart succeeds but `/api/health` does not respond -> fail update.
- Nginx config test fails -> do not reload Nginx.

### 5. Good/Base/Bad Cases

- Good: `deploy/update.sh` pulls fast-forward changes, refreshes dependencies, builds frontend, restarts `attuno-api`, verifies health, then reloads Nginx.
- Base: `SKIP_GIT_PULL=1 bash deploy/update.sh` updates dependencies and runtime when code was already changed manually.
- Bad: running `npm run dev` or `start_attuno_studio.bat` as the production server.

### 6. Tests Required

- Run `bash -n deploy/install.sh` and `bash -n deploy/update.sh` with a real Bash implementation.
- Run frontend production build: `npm run build`.
- Run a backend API check, at minimum `python -m pytest tests/test_backend_api.py -q` or a live `/api/health` check on the server.

### 7. Wrong vs Correct

#### Wrong

```bash
cd attuno-studio/ui-prototype
npm run dev
```

Using the Vite dev server as the public production frontend makes updates, service restarts, and reverse proxy behavior fragile.

#### Correct

```bash
cd /opt/attuno/PicCreator
bash deploy/update.sh
```

The update script rebuilds static frontend assets, restarts the systemd API service, verifies `/api/health`, and reloads Nginx only after config validation.
