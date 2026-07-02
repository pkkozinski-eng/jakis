"""Konfiguracja aplikacji — wczytywana ze zmiennych środowiskowych / pliku .env."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

# Minimalny loader .env bez dodatkowej zależności (python-dotenv opcjonalny).
def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv()


class Settings:
    # Anthropic / Vision
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
    # Gdy brak klucza — działamy w trybie demo (deterministyczny mock zamiast API).
    mock_mode: bool = os.environ.get("FSA_MOCK_MODE", "").lower() in {"1", "true", "yes"}

    # Dane fundamentalne
    fred_api_key: str = os.environ.get("FRED_API_KEY", "")

    # Reguły analizy
    entry_threshold: int = int(os.environ.get("FSA_ENTRY_THRESHOLD", "7"))
    min_rr: float = float(os.environ.get("FSA_MIN_RR", "2.0"))
    # Bufor SL za ekstremum formacji, jako ułamek odległości wejście-ekstremum
    # (0.1 = 10% dystansu). Skaluje się z rozmiarem formacji, niezależnie od pary.
    sl_buffer_pct: float = float(os.environ.get("FSA_SL_BUFFER_PCT", "0.1"))

    # Storage
    db_path: str = os.environ.get(
        "FSA_DB_PATH",
        str(Path(__file__).resolve().parent.parent / "history.db"),
    )

    @property
    def has_anthropic_key(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def effective_mock_mode(self) -> bool:
        # Tryb mock jeśli wymuszony lub gdy brak klucza API.
        return self.mock_mode or not self.has_anthropic_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
