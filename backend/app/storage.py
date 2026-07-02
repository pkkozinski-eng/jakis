"""Lokalny zapis historii analiz w SQLite (stdlib, bez dodatkowych zależności)."""
from __future__ import annotations

import datetime as dt
import json
import sqlite3
from pathlib import Path
from typing import List, Optional

from .schemas import AnalysisResult


class HistoryStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    pair TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    score INTEGER NOT NULL,
                    verdict TEXT NOT NULL,
                    payload TEXT NOT NULL
                )
                """
            )

    def save(self, result: AnalysisResult) -> AnalysisResult:
        created = result.created_at or dt.datetime.now().isoformat(timespec="seconds")
        result.created_at = created
        payload = result.model_dump_json()
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO analyses (created_at, pair, timeframe, score, verdict, payload) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (created, result.pair, result.timeframe, result.score,
                 result.verdict.value, payload),
            )
            result.id = cur.lastrowid
        return result

    def list(self, limit: int = 50) -> List[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, created_at, pair, timeframe, score, verdict "
                "FROM analyses ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get(self, analysis_id: int) -> Optional[AnalysisResult]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload FROM analyses WHERE id = ?", (analysis_id,)
            ).fetchone()
        if row is None:
            return None
        return AnalysisResult.model_validate(json.loads(row["payload"]))
