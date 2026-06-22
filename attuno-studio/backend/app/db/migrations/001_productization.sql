CREATE TABLE IF NOT EXISTS user_runtime_state (
    user_id TEXT PRIMARY KEY,
    tavily_next_key_index INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tavily_key_state (
    user_id TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL,
    key_index INTEGER NOT NULL,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_status TEXT NOT NULL DEFAULT '',
    last_message TEXT NOT NULL DEFAULT '',
    last_used_at TIMESTAMPTZ,
    last_failed_at TIMESTAMPTZ,
    cooldown_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_tavily_key_state_user_cooldown
    ON tavily_key_state (user_id, cooldown_until);

CREATE TABLE IF NOT EXISTS search_events (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    query TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
    search_profile TEXT NOT NULL DEFAULT '',
    search_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_events_user_created
    ON search_events (user_id, created_at DESC);
