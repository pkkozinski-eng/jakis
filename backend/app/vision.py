"""Warstwa 1 — odczyt obrazu przez Claude Vision (z deterministycznym trybem mock).

Gdy brak ANTHROPIC_API_KEY (lub FSA_MOCK_MODE=1) używamy trybu demo: zwracamy
deterministyczny, sensowny odczyt, żeby aplikacja działała end-to-end bez klucza.
"""
from __future__ import annotations

import base64
from typing import Optional

from .config import Settings
from .prompts import VISION_SYSTEM_PROMPT, VISION_TOOL
from .schemas import VisionAnalysis


class VisionError(RuntimeError):
    """Błąd odczytu obrazu przez model wizyjny."""


def _guess_media_type(filename: Optional[str], data: bytes) -> str:
    if filename:
        low = filename.lower()
        if low.endswith(".png"):
            return "image/png"
        if low.endswith((".jpg", ".jpeg")):
            return "image/jpeg"
        if low.endswith(".webp"):
            return "image/webp"
        if low.endswith(".gif"):
            return "image/gif"
    # Detekcja po magic bytes.
    if data[:8].startswith(b"\x89PNG"):
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def read_chart(
    image_bytes: bytes,
    pair: str,
    timeframe: str,
    settings: Settings,
    *,
    filename: Optional[str] = None,
) -> VisionAnalysis:
    """Zwraca ustrukturyzowany odczyt wykresu (warstwa 1)."""
    if settings.effective_mock_mode:
        return _mock_reading(pair, timeframe)
    return _call_claude(image_bytes, pair, timeframe, settings, filename=filename)


def _call_claude(
    image_bytes: bytes,
    pair: str,
    timeframe: str,
    settings: Settings,
    *,
    filename: Optional[str],
) -> VisionAnalysis:
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover
        raise VisionError(
            "Pakiet 'anthropic' nie jest zainstalowany. Zainstaluj zależności lub włącz FSA_MOCK_MODE=1."
        ) from exc

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    media_type = _guess_media_type(filename, image_bytes)
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")

    user_text = (
        f"Para walutowa: {pair}. Rama czasowa: {timeframe}. "
        f"Odczytaj wykres i wywołaj narzędzie record_chart_reading."
    )

    try:
        msg = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1500,
            system=VISION_SYSTEM_PROMPT,
            tools=[VISION_TOOL],
            tool_choice={"type": "tool", "name": "record_chart_reading"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": user_text},
                    ],
                }
            ],
        )
    except Exception as exc:  # pragma: no cover - zależne od sieci
        raise VisionError(f"Błąd wywołania Claude API: {exc}") from exc

    tool_input = None
    for block in msg.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "record_chart_reading":
            tool_input = block.input
            break
    if tool_input is None:
        raise VisionError("Model nie zwrócił ustrukturyzowanego odczytu (brak tool_use).")

    # Nadpisujemy parę/ramę tym, co wybrał użytkownik (autorytatywne).
    tool_input["pair"] = pair
    tool_input["timeframe"] = timeframe
    try:
        return VisionAnalysis.model_validate(tool_input)
    except Exception as exc:
        raise VisionError(f"Odczyt modelu nie spełnia schematu: {exc}") from exc


def _mock_reading(pair: str, timeframe: str) -> VisionAnalysis:
    """Deterministyczny odczyt demonstracyjny (byczy pin bar na wsparciu, R:R ~1:2.5)."""
    from .schemas import Direction, KeyLevel, LevelType, Pattern, Trend

    is_jpy = "JPY" in pair.upper()
    if is_jpy:
        support, current, extreme, resistance = 155.20, 155.55, 155.05, 156.90
    else:
        support, current, extreme, resistance = 1.0820, 1.0835, 1.0808, 1.0895

    return VisionAnalysis(
        pair=pair,
        timeframe=timeframe,
        trend=Trend.BULLISH,
        trend_structure="Układ wyższych dołków (HL) i wyższych szczytów (HH) na tej ramie.",
        price_vs_levels="Cena odbija od kluczowego wsparcia w kierunku trendu.",
        dema_configuration="Cena nad DEMA 20 i 50, DEMA rozbieżne w górę.",
        pattern=Pattern.PIN_BAR,
        pattern_direction=Direction.BULLISH,
        pattern_quality=8,
        pattern_at_key_level=True,
        key_levels=[
            KeyLevel(price=support, type=LevelType.SUPPORT, strength=3),
            KeyLevel(price=resistance, type=LevelType.RESISTANCE, strength=2),
        ],
        current_price=current,
        pattern_extreme=extreme,
        nearest_target_level=resistance,
        higher_tf_trend=Trend.BULLISH,
        confidence=0.82,
        notes="TRYB DEMO (brak klucza API): odczyt przykładowy, nie z realnego obrazu.",
    )
