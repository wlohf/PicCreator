import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import app_runtime


TARGET_USER_ID = "xyleisure"


def main() -> int:
    raw_keys = os.environ.get("TAVILY_API_KEYS") or os.environ.get("TAVILY_API_KEY") or ""
    if not raw_keys.strip():
        print("No Tavily keys found. Set TAVILY_API_KEYS or TAVILY_API_KEY, then rerun.")
        return 1

    app_runtime.save_model_config_to_files(
        "", "", "", "", "",
        "", "", "", "", "",
        tavily_api_keys=raw_keys,
        user_id=TARGET_USER_ID,
    )
    loaded = app_runtime.load_model_config_for_ui(TARGET_USER_ID)
    key_count = len([item for item in loaded.get("tavilyApiKeys", "").splitlines() if item.strip()])
    next_index = int(loaded.get("tavilyNextKeyIndex") or 0)
    print(f"Saved {key_count} Tavily key(s) for {TARGET_USER_ID}; next index: {next_index}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
