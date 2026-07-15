from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT_DIR / ".env"
_ENV_LOADED = False


def load_env_file(path: Path = ENV_FILE) -> None:
    global _ENV_LOADED
    if _ENV_LOADED or not path.exists():
        _ENV_LOADED = True
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)

    _ENV_LOADED = True


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def env_str(name: str, default: str) -> str:
    return os.getenv(name, default).strip() or default


load_env_file()

OLLAMA_BASE_URL = env_str("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_SMALL_MODEL = env_str("OLLAMA_SMALL_MODEL", "gemma3:270m")
OLLAMA_LARGE_MODEL = env_str("OLLAMA_LARGE_MODEL", "gemma3:4b")
OLLAMA_CONTEXT_WINDOW = env_int("OLLAMA_CONTEXT_WINDOW", 2048)
OLLAMA_MAX_INPUT_TOKENS = env_int("OLLAMA_MAX_INPUT_TOKENS", 1400)
OLLAMA_MAX_OUTPUT_TOKENS = env_int("OLLAMA_MAX_OUTPUT_TOKENS", 512)
OLLAMA_TIMEOUT_SECONDS = env_int("OLLAMA_TIMEOUT_SECONDS", 90)
