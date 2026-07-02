"""Orkiestracja pełnego potoku analizy (warstwa 1 -> warstwa 2 -> wynik).

Kolejność:
  1. Vision (warstwa 1) -> VisionAnalysis
  2. compute_sltp        -> SL/TP/R:R
  3. validate            -> spójność (twarde błędy przerywają)
  4. compute_score       -> wynik 1-10 (reguły w kodzie)
  5. get_fundamentals    -> kontekst makro + ostrzeżenia
  6. werdykt + uzasadnienie + złożenie AnalysisResult
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from .config import Settings, get_settings
from .fundamentals import get_fundamentals
from .schemas import (
    AnalysisResult,
    Direction,
    Pattern,
    Verdict,
    VisionAnalysis,
)
from .scoring import compute_score
from .sltp import compute_sltp
from .validation import validate
from .vision import read_chart


class AnalysisError(RuntimeError):
    """Twarda niespójność danych — nie zgadujemy, zwracamy błąd."""

    def __init__(self, message: str, errors: list[str]):
        super().__init__(message)
        self.errors = errors


def analyze_image(
    image_bytes: bytes,
    pair: str,
    timeframe: str,
    *,
    settings: Optional[Settings] = None,
    filename: Optional[str] = None,
    today: Optional[dt.date] = None,
) -> AnalysisResult:
    """Pełny potok od obrazu do sztywnego wyniku."""
    settings = settings or get_settings()
    vision = read_chart(image_bytes, pair, timeframe, settings, filename=filename)
    return analyze_vision(vision, settings=settings, today=today)


def analyze_vision(
    vision: VisionAnalysis,
    *,
    settings: Optional[Settings] = None,
    today: Optional[dt.date] = None,
) -> AnalysisResult:
    """Potok warstwy 2 na gotowym odczycie (użyteczne w testach)."""
    settings = settings or get_settings()

    sltp = compute_sltp(vision, min_rr=settings.min_rr, buffer_pct=settings.sl_buffer_pct)

    report = validate(vision, sltp)
    if not report.ok:
        raise AnalysisError(
            "Dane analizy są niespójne lub niekompletne — analiza przerwana.",
            report.errors,
        )

    factors, raw_pts, max_pts, score = compute_score(vision, sltp, min_rr=settings.min_rr)

    fundamentals = get_fundamentals(
        vision.pair, vision.pattern_direction, settings, today=today
    )

    warnings = list(report.warnings)
    verdict, reasoning, extra_warnings = _decide(
        vision, sltp, score, settings, fundamentals
    )
    warnings.extend(extra_warnings)

    return AnalysisResult(
        pair=vision.pair,
        timeframe=vision.timeframe,
        trend=vision.trend,
        pattern=vision.pattern,
        pattern_direction=vision.pattern_direction,
        factors=factors,
        raw_points=raw_pts,
        max_points=max_pts,
        score=score,
        verdict=verdict,
        threshold=settings.entry_threshold,
        sltp=sltp,
        fundamentals=fundamentals,
        reasoning=reasoning,
        warnings=warnings,
        vision_confidence=vision.confidence,
    )


def _decide(vision, sltp, score, settings, fundamentals) -> tuple[Verdict, str, list[str]]:
    """Wyznacza werdykt (technika) + nakłada nadrzędne blokady fundamentalne."""
    extra_warnings: list[str] = []
    threshold = settings.entry_threshold

    technical_enter = score >= threshold and vision.pattern != Pattern.NONE
    verdict = Verdict.ENTER if technical_enter else Verdict.SKIP

    # --- Nadrzędne blokady fundamentalne (mogą tylko ZAOSTRZYĆ werdykt) --- #
    blocked_by_news = False
    if fundamentals.high_impact_event_warning:
        extra_warnings.append(fundamentals.high_impact_event_warning)
        if verdict == Verdict.ENTER:
            verdict = Verdict.SKIP
            blocked_by_news = True

    fundamental_conflict = fundamentals.alignment == "przeciwny"
    if fundamental_conflict:
        extra_warnings.append(
            f"Konflikt: sygnał techniczny {vision.pattern_direction.value}, "
            f"a nastawienie fundamentalne pary jest przeciwne "
            f"(carry/stopy: {fundamentals.rate_differential} p.p.). Zwiększone ryzyko."
        )

    if not sltp.rr_ok and verdict == Verdict.ENTER and sltp.rr is not None:
        # Score >=7 możliwe nawet bez punktu za R:R; ale wchodzenie bez 1:2 flagujemy.
        extra_warnings.append("Wejście mimo R:R < 1:2 — rozważ ciaśniejszy cel lub rezygnację.")

    reasoning = _build_reasoning(
        vision, sltp, score, threshold, verdict, fundamentals, blocked_by_news
    )
    return verdict, reasoning, extra_warnings


def _build_reasoning(
    vision, sltp, score, threshold, verdict, fundamentals, blocked_by_news
) -> str:
    parts: list[str] = []
    parts.append(
        f"Na ramie {vision.timeframe} dla {vision.pair} rozpoznano trend {vision.trend.value} "
        f"({vision.trend_structure})."
    )
    if vision.pattern != Pattern.NONE:
        loc = "na kluczowym poziomie S/R" if vision.pattern_at_key_level else "poza kluczowym poziomem"
        parts.append(
            f"Formacja: {vision.pattern.value} ({vision.pattern_direction.value}), {loc}."
        )
    else:
        parts.append("Nie rozpoznano czytelnej formacji price action.")

    if sltp.take_profit is not None and sltp.rr is not None:
        parts.append(
            f"Proponowany SL {sltp.stop_loss}, TP {sltp.take_profit}, R:R 1:{sltp.rr:.2f}."
        )
    else:
        parts.append(
            f"Proponowany SL {sltp.stop_loss}; brak wiarygodnego TP dającego R:R >= 1:{settings_min_rr(threshold)} "
            f"— to istotne ryzyko."
        )

    # Fundamenty.
    if fundamentals.rate_differential is not None:
        parts.append(
            f"Fundamenty: różnica stóp {fundamentals.base_ccy}-{fundamentals.quote_ccy} "
            f"= {fundamentals.rate_differential} p.p. (carry: {fundamentals.carry_bias.value}), "
            f"nastawienie pary: {fundamentals.fundamental_bias.value}, "
            f"zgodność z technika: {fundamentals.alignment} [źródło: {fundamentals.source}, {fundamentals.as_of}]."
        )

    parts.append(f"Wynik regułowy: {score}/10 (próg wejścia {threshold}).")

    if verdict == Verdict.ENTER:
        parts.append("WERDYKT: WCHODZĘ — setup spełnia próg i reguły price action.")
    else:
        if blocked_by_news:
            parts.append(
                "WERDYKT: NIE WCHODZĘ — mimo wyniku technicznego blokada z powodu nadchodzącego "
                "wydarzenia wysokiej wagi."
            )
        elif score < threshold:
            parts.append(f"WERDYKT: NIE WCHODZĘ — wynik {score} poniżej progu {threshold}.")
        else:
            parts.append("WERDYKT: NIE WCHODZĘ — brak wystarczających warunków setupu.")

    return " ".join(parts)


def settings_min_rr(_threshold: int) -> str:
    # Pomocniczo — R:R minimum jest stałe 2 w tekście uzasadnienia.
    return "2"
