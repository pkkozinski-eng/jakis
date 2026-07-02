"""FastAPI — punkt wejścia HTTP dla Forex Signal Analyzer."""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .analyzer import AnalysisError, analyze_image
from .config import get_settings
from .storage import HistoryStore

settings = get_settings()
store = HistoryStore(settings.db_path)

app = FastAPI(
    title="Forex Signal Analyzer",
    description="Analiza wykresów forex metodą price action (Nial Fuller) — AI odczyt + reguły w kodzie.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT = {"image/png", "image/jpeg", "image/webp", "image/gif"}
DEFAULT_PAIRS = ["EUR/USD", "USD/JPY", "GBP/USD"]
TIMEFRAMES = ["D1", "H4", "H1"]


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "mock_mode": settings.effective_mock_mode,
        "has_anthropic_key": settings.has_anthropic_key,
        "model": settings.anthropic_model,
        "entry_threshold": settings.entry_threshold,
        "min_rr": settings.min_rr,
    }


@app.get("/api/config")
def config() -> dict:
    return {
        "default_pairs": DEFAULT_PAIRS,
        "timeframes": TIMEFRAMES,
        "mock_mode": settings.effective_mock_mode,
        "entry_threshold": settings.entry_threshold,
    }


@app.post("/api/analyze")
async def analyze(
    image: UploadFile = File(...),
    pair: str = Form(...),
    timeframe: str = Form(...),
) -> dict:
    if image.content_type not in ALLOWED_CONTENT:
        raise HTTPException(
            status_code=415,
            detail=f"Nieobsługiwany typ pliku: {image.content_type}. Dozwolone: {sorted(ALLOWED_CONTENT)}",
        )
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Pusty plik obrazu.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Plik za duży (max 10 MB).")
    if not pair.strip():
        raise HTTPException(status_code=400, detail="Brak pary walutowej.")
    if timeframe not in TIMEFRAMES:
        raise HTTPException(
            status_code=400, detail=f"Nieznana rama czasowa. Dozwolone: {TIMEFRAMES}"
        )

    try:
        result = analyze_image(
            data, pair.strip(), timeframe, settings=settings, filename=image.filename
        )
    except AnalysisError as exc:
        # Niespójne dane — zwracamy 422 z listą błędów zamiast zgadywać.
        raise HTTPException(
            status_code=422,
            detail={"message": str(exc), "errors": exc.errors},
        )
    except Exception as exc:  # np. VisionError
        raise HTTPException(status_code=502, detail=f"Analiza nie powiodła się: {exc}")

    result = store.save(result)
    return result.model_dump()


@app.get("/api/history")
def history(limit: int = 50) -> dict:
    return {"items": store.list(limit=limit)}


@app.get("/api/history/{analysis_id}")
def history_item(analysis_id: int) -> dict:
    result = store.get(analysis_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono analizy.")
    return result.model_dump()
