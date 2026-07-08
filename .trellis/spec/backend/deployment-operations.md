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
- Generation runtime artifacts, including intermediate output images, image-edit outputs, annotation-edit outputs, and validation records, must be written under the runtime data namespace, not `attuno-studio/outputs` in the Git checkout.
- Per-user generation output directories should use `get_user_data_dir(user_id) / "outputs" / <normalized project_id>` so API generation, image editing, result storage, and asset serving share the same writable namespace. Reuse the shared output-dir helper for every `run_pipeline(...)` call that can write artifacts, and pass it through `record_output_dir`.
- Nginx serves `attuno-studio/ui-prototype/dist` and reverse-proxies `/api/` to `http://127.0.0.1:8787`.
- Deployment scripts must not overwrite existing `.env` or `config.json`; they may create them from examples when missing.

### 4. Validation & Error Matrix

- Missing `attuno-studio/` or `ui-prototype/` -> fail before installing dependencies.
- Node.js major version below 20 -> fail with an upgrade message before build.
- `git pull --ff-only` conflict -> fail without overwriting server-local changes.
- API service restart succeeds but `/api/health` does not respond -> fail update.
- Nginx config test fails -> do not reload Nginx.
- API generation cannot create the runtime output directory -> return a clear permission/configuration error that names `ATTUNO_STUDIO_DATA_DIR` or `RENDER_AGENT_DATA_DIR`.

### 5. Good/Base/Bad Cases

- Good: `deploy/update.sh` pulls fast-forward changes, refreshes dependencies, builds frontend, restarts `attuno-api`, verifies health, then reloads Nginx.
- Base: `SKIP_GIT_PULL=1 bash deploy/update.sh` updates dependencies and runtime when code was already changed manually.
- Bad: running `npm run dev` or `start_attuno_studio.bat` as the production server.
- Bad: generation writes to `/opt/attuno/PicCreator/attuno-studio/outputs`; the service user may not own the Git checkout, and updates can replace or lock that path.

### 6. Tests Required

- Run `bash -n deploy/install.sh` and `bash -n deploy/update.sh` with a real Bash implementation.
- Run frontend production build: `npm run build`.
- Run a backend API check, at minimum `python -m pytest tests/test_backend_api.py -q` or a live `/api/health` check on the server.
- Backend generation and image-edit tests should assert `record_output_dir` resolves under `ATTUNO_STUDIO_DATA_DIR`/user namespace rather than the repository `outputs` directory.

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

#### Wrong

```python
record_output_dir = Path(__file__).resolve().parent / "outputs"
```

This writes runtime artifacts into the deployed Git checkout and can fail with `PermissionError` under systemd.

#### Correct

```python
record_output_dir = get_user_data_dir(user_id) / "outputs" / normalize_user_id(project_id)
```

Generation artifacts stay in the configured runtime data directory, alongside persisted result assets.

## Scenario: Web GitHub Release Update

### 1. Scope / Trigger

- Trigger: Web 端“设置 -> 系统维护”检测或执行生产更新。
- Applies when changing `backend.app.services.update_service`, `/api/system/update/*` routes, update status response fields, or deployment docs for release-driven updates.
- This is a production server update path, not a desktop auto-updater or release-asset installer.

### 2. Signatures

- `GET /api/system/update/status` returns cached/non-fetching update status when available.
- `POST /api/system/update/check` fetches latest update metadata.
- `POST /api/system/update/apply` applies the detected update and runs `bash deploy/update.sh`.
- `GET /api/system/status` returns deployment-admin-only diagnostics for database status, runtime data directory writability, and update readiness.
- Default update source: `ATTUNO_UPDATE_SOURCE=release`.
- Compatibility source: `ATTUNO_UPDATE_SOURCE=branch` for old `origin/main` fast-forward behavior.

### 3. Contracts

- Release mode reads GitHub latest release via repository `owner/repo`, derived from `origin` or `ATTUNO_GITHUB_REPOSITORY`.
- Release mode consumes only the latest release `tag_name`; it must not accept frontend-supplied branch/tag/asset URLs.
- Release mode fetches the release tag, resolves it to a commit, checks that current commit is equal to or an ancestor of that commit, then checks out the target commit detached.
- After release checkout, `deploy/update.sh` must run with `SKIP_GIT_PULL=1`; the script remains responsible for dependencies, migrations, frontend build, service restart, health check, and Nginx reload.
- Optional env keys:
  - `ATTUNO_GITHUB_REPOSITORY=owner/repo`
  - `ATTUNO_GITHUB_TOKEN=<token>` for private repos or rate limit headroom; never return it to frontend or logs.
  - `ATTUNO_GITHUB_API_VERSION=<version>` only when GitHub API version needs explicit override.
- Update status response may include `update_source`, `github_repository`, `current_version`, `latest_version`, `latest_release_tag`, `latest_release_name`, `latest_release_url`, `latest_release_published_at`, and `latest_release_commit`.
- `has_update` means a newer target exists; `can_apply` means the server can safely run apply now. When `can_apply=false`, `apply_blockers` must explain the blocking conditions in user-actionable text.
- System status response must not expose secrets. It may include data directory path, database fallback/configuration state, update source, current/latest versions, and apply blockers.

### 4. Validation & Error Matrix

- Missing/invalid admin credentials -> HTTP 401 before update logic.
- `ATTUNO_UPDATE_ENABLED` not set to `1` -> apply fails without running scripts.
- Dirty Git working tree -> status includes `can_apply=false`; apply fails before checkout.
- Cannot infer GitHub repo from `origin` and no `ATTUNO_GITHUB_REPOSITORY` -> status/check returns a clear configuration error.
- GitHub latest release request fails or has no `tag_name` -> check returns a clear GitHub release error.
- Release tag is invalid or cannot resolve to a commit -> check/apply fails before script execution.
- Current commit is not an ancestor of latest release commit -> `has_update=false`, `fast_forward=false`, apply fails.
- `deploy/update.sh` returns non-zero -> apply returns redacted log excerpt.

### 5. Good/Base/Bad Cases

- Good: current server is on `v1.0.0`, GitHub latest release is `v1.1.0`, current commit is an ancestor; check shows update available, apply checks out `v1.1.0`, runs `deploy/update.sh` with `SKIP_GIT_PULL=1`, service becomes healthy.
- Base: deployment has no releases yet; status/check explains the GitHub latest release failure instead of silently pulling `main`.
- Bad: frontend passes a tag or asset URL to apply; backend must ignore/reject this pattern and only use server-side latest release lookup.

### 6. Tests Required

- Unit test branch compatibility mode still fetches fixed `origin/main`.
- Unit test release mode fetches latest release tag, resolves commit, and sets `has_update`/release fields correctly.
- Unit test status readiness reports `can_apply=false` and `apply_blockers` for disabled updates, dirty worktrees, or non-fast-forward targets.
- Unit test release apply checks out the release commit and invokes update script with `SKIP_GIT_PULL=1` while stripping secrets from child env.
- API auth test confirms `/api/system/update/*` still requires update admin credentials.
- API auth test confirms `/api/system/status` requires update admin credentials and reports storage/database/update diagnostics.
- Frontend build/typecheck should cover new optional status fields.

### 7. Wrong vs Correct

#### Wrong

```python
tag = payload["tag"]
subprocess.run(f"git checkout {tag} && bash deploy/update.sh", shell=True)
```

#### Correct

```python
status = check_for_updates()
_checkout_release_status(status)
env["SKIP_GIT_PULL"] = "1"
subprocess.run(["bash", str(UPDATE_SCRIPT)], cwd=REPO_ROOT, env=env, check=False)
```
