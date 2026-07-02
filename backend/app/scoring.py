"""Regułowy scoring 1-10 (warstwa 2) — czysta, testowalna, kalibrowalna funkcja.

To NIE jest ocena AI. Backend przelicza wynik programistycznie z ustrukturyzowanych
danych warstwy 1, żeby ten sam typ setupu dostawał ten sam wynik (powtarzalność).

Wagi (sekcja 4 wymagań):
  * Zgodność z trendem głównym ............ 0-3 pkt
  * Formacja na kluczowym poziomie S/R .... 0-2 pkt
  * Jakość / czystość formacji ............ 0-2 pkt
  * Potwierdzenie multi-timeframe ......... 0-2 pkt   (tylko gdy dostępne dane)
  * R:R >= 1:2 ............................ 0-1 pkt
  Suma max = 10 (lub 8 gdy brak danych MTF — wynik normalizowany do skali 1-10).

Wszystkie progi to stałe modułowe — łatwe do kalibracji bez ruszania promptu AI.
"""
from __future__ import annotations

from typing import List

from .schemas import Direction, ScoreFactor, SLTP, Trend, VisionAnalysis

# ---- Kalibrowalne stałe --------------------------------------------------- #
TREND_ALIGNED_POINTS = 3
TREND_SIDEWAYS_POINTS = 1
TREND_COUNTER_POINTS = 0

QUALITY_HIGH_THRESHOLD = 8   # pattern_quality >= 8 -> 2 pkt
QUALITY_MID_THRESHOLD = 5    # 5..7 -> 1 pkt, <5 -> 0 pkt


def _trend_to_direction(trend: Trend) -> Direction:
    if trend == Trend.BULLISH:
        return Direction.BULLISH
    if trend == Trend.BEARISH:
        return Direction.BEARISH
    return Direction.NONE


def score_trend_alignment(vision: VisionAnalysis) -> ScoreFactor:
    """0-3: zgodność formacji z dominującym trendem tej ramy."""
    trend_dir = _trend_to_direction(vision.trend)
    pd = vision.pattern_direction

    if vision.trend == Trend.SIDEWAYS:
        pts = TREND_SIDEWAYS_POINTS
        why = "Trend boczny — formacja neutralna względem kierunku (setup zakresowy)."
    elif pd == Direction.NONE:
        pts = TREND_COUNTER_POINTS
        why = "Brak jednoznacznego kierunku formacji — brak zgodności z trendem."
    elif pd == trend_dir:
        pts = TREND_ALIGNED_POINTS
        why = f"Formacja {pd.value} zgodna z trendem {vision.trend.value} — sygnał z trendem."
    else:
        pts = TREND_COUNTER_POINTS
        why = f"Formacja {pd.value} przeciwna do trendu {vision.trend.value} — setup kontrtrendowy."

    return ScoreFactor(
        name="Zgodność z trendem głównym",
        points=pts, max_points=3, applicable=True, rationale=why,
    )


def score_key_level(vision: VisionAnalysis) -> ScoreFactor:
    """0-2: czy formacja występuje na kluczowym poziomie S/R."""
    if vision.pattern_at_key_level:
        pts, why = 2, "Formacja na kluczowym poziomie S/R / strefie podaży-popytu."
    else:
        pts, why = 0, "Formacja w przypadkowym miejscu, poza kluczowym poziomem — niska wartość."
    return ScoreFactor(
        name="Formacja na kluczowym poziomie S/R",
        points=pts, max_points=2, applicable=True, rationale=why,
    )


def score_pattern_quality(vision: VisionAnalysis) -> ScoreFactor:
    """0-2: czystość samej formacji świecowej (z surowej oceny modelu)."""
    from .schemas import Pattern

    if vision.pattern == Pattern.NONE:
        return ScoreFactor(
            name="Jakość / czystość formacji",
            points=0, max_points=2, applicable=True,
            rationale="Brak rozpoznanej formacji price action.",
        )
    q = vision.pattern_quality
    if q >= QUALITY_HIGH_THRESHOLD:
        pts, why = 2, f"Bardzo czysta formacja (jakość {q}/10): wyraźne odrzucenie, prawidłowy korpus."
    elif q >= QUALITY_MID_THRESHOLD:
        pts, why = 1, f"Przeciętna formacja (jakość {q}/10): czytelna, ale z zastrzeżeniami."
    else:
        pts, why = 0, f"Słaba/niejednoznaczna formacja (jakość {q}/10)."
    return ScoreFactor(
        name="Jakość / czystość formacji",
        points=pts, max_points=2, applicable=True, rationale=why,
    )


def score_multi_timeframe(vision: VisionAnalysis) -> ScoreFactor:
    """0-2: potwierdzenie wyższej ramy. Applicable tylko gdy dostępny higher_tf_trend."""
    if vision.higher_tf_trend is None:
        return ScoreFactor(
            name="Potwierdzenie multi-timeframe",
            points=0, max_points=2, applicable=False,
            rationale="Brak danych z wyższej ramy czasowej — czynnik pominięty w normalizacji.",
        )
    htf_dir = _trend_to_direction(vision.higher_tf_trend)
    pd = vision.pattern_direction
    if pd == Direction.NONE:
        pts, why = 0, "Brak kierunku formacji — nie można potwierdzić wyższą ramą."
    elif htf_dir == pd:
        pts, why = 2, f"Wyższa rama ({vision.higher_tf_trend.value}) potwierdza kierunek sygnału."
    elif vision.higher_tf_trend == Trend.SIDEWAYS:
        pts, why = 1, "Wyższa rama w konsolidacji — częściowe (neutralne) potwierdzenie."
    else:
        pts, why = 0, f"Wyższa rama ({vision.higher_tf_trend.value}) przeciwna do sygnału."
    return ScoreFactor(
        name="Potwierdzenie multi-timeframe",
        points=pts, max_points=2, applicable=True, rationale=why,
    )


def score_rr(sltp: SLTP, *, min_rr: float = 2.0) -> ScoreFactor:
    """0-1: czy proponowany SL/TP daje R:R >= 1:2."""
    if sltp.rr_ok:
        pts, why = 1, f"R:R 1:{sltp.rr:.2f} spełnia minimum 1:{min_rr:.0f}."
    elif sltp.rr is None:
        pts, why = 0, "Brak policzalnego R:R (brak sensownego TP)."
    else:
        pts, why = 0, f"R:R 1:{sltp.rr:.2f} poniżej wymaganego 1:{min_rr:.0f}."
    return ScoreFactor(
        name="R:R proponowanego SL/TP (>= 1:2)",
        points=pts, max_points=1, applicable=True, rationale=why,
    )


def compute_score(
    vision: VisionAnalysis, sltp: SLTP, *, min_rr: float = 2.0
) -> tuple[List[ScoreFactor], float, float, int]:
    """Główna funkcja scoringu.

    Zwraca: (lista czynników, suma punktów zdobytych, suma max punktów, wynik 1-10).
    Wynik jest normalizowany do skali 1-10 względem sumy MAX *stosowalnych* czynników,
    dzięki czemu próg >=7 pozostaje spójny także gdy brak danych multi-timeframe.
    """
    factors = [
        score_trend_alignment(vision),
        score_key_level(vision),
        score_pattern_quality(vision),
        score_multi_timeframe(vision),
        score_rr(sltp, min_rr=min_rr),
    ]
    applicable = [f for f in factors if f.applicable]
    raw = sum(f.points for f in applicable)
    max_pts = sum(f.max_points for f in applicable)

    if max_pts <= 0:
        normalized = 1
    else:
        normalized = round(raw / max_pts * 10)
        normalized = max(1, min(10, normalized))

    return factors, raw, max_pts, normalized
