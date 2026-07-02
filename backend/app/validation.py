"""Walidacja spójności warstwy 2 — programistyczna weryfikacja danych z warstwy 1.

Wykrywa dane niekompletne lub sprzeczne i zwraca:
  * errors  -> twarde niespójności (aplikacja przerywa i zwraca błąd zamiast zgadywać),
  * warnings -> miękkie zastrzeżenia (analiza kontynuowana, ale użytkownik ostrzeżony).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .schemas import Direction, Pattern, SLTP, Trend, VisionAnalysis


@dataclass
class ConsistencyReport:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _trend_dir(trend: Trend) -> Direction:
    if trend == Trend.BULLISH:
        return Direction.BULLISH
    if trend == Trend.BEARISH:
        return Direction.BEARISH
    return Direction.NONE


def validate(vision: VisionAnalysis, sltp: SLTP) -> ConsistencyReport:
    """Sprawdza spójność odczytu i wyliczonych poziomów."""
    rep = ConsistencyReport()

    # 1) Formacja obecna, ale bez kierunku -> sprzeczność.
    if vision.pattern != Pattern.NONE and vision.pattern_direction == Direction.NONE:
        rep.errors.append(
            f"Rozpoznano formację '{vision.pattern.value}', ale bez kierunku sygnału — dane sprzeczne."
        )
    # Kierunek bez formacji -> sprzeczność.
    if vision.pattern == Pattern.NONE and vision.pattern_direction != Direction.NONE:
        rep.errors.append(
            "Podano kierunek sygnału bez rozpoznanej formacji — dane sprzeczne."
        )

    # 2) Ceny muszą być dodatnie i sensowne.
    if vision.current_price <= 0:
        rep.errors.append("Aktualna cena musi być dodatnia.")
    if vision.pattern_extreme <= 0 and vision.pattern != Pattern.NONE:
        rep.errors.append("Ekstremum formacji musi być dodatnie.")

    # 3) Ekstremum po właściwej stronie ceny względem kierunku.
    if vision.pattern_direction == Direction.BULLISH and vision.pattern_extreme >= vision.current_price:
        rep.errors.append(
            "Sygnał byczy, ale ekstremum formacji (baza SL) nie leży poniżej ceny — niespójne."
        )
    if vision.pattern_direction == Direction.BEARISH and vision.pattern_extreme <= vision.current_price:
        rep.errors.append(
            "Sygnał niedźwiedzi, ale ekstremum formacji (baza SL) nie leży powyżej ceny — niespójne."
        )

    # 4) Poprawność geometrii SL/TP (SL i TP po właściwych stronach wejścia).
    if vision.pattern_direction == Direction.BULLISH:
        if sltp.stop_loss >= sltp.entry:
            rep.errors.append("Dla longa SL musi być poniżej wejścia.")
        if sltp.take_profit is not None and sltp.take_profit <= sltp.entry:
            rep.errors.append("Dla longa TP musi być powyżej wejścia.")
    elif vision.pattern_direction == Direction.BEARISH:
        if sltp.stop_loss <= sltp.entry:
            rep.errors.append("Dla shorta SL musi być powyżej wejścia.")
        if sltp.take_profit is not None and sltp.take_profit >= sltp.entry:
            rep.errors.append("Dla shorta TP musi być poniżej wejścia.")

    # 5) Kontrola poprawności policzonego R:R (re-kalkulacja).
    if sltp.take_profit is not None and sltp.risk > 0 and sltp.reward is not None:
        expected_rr = round(sltp.reward / sltp.risk, 2)
        if sltp.rr is None or abs(expected_rr - sltp.rr) > 0.01:
            rep.errors.append(
                f"Niespójny R:R: zgłoszono {sltp.rr}, przeliczenie daje {expected_rr}."
            )

    # 6) Miękkie ostrzeżenia.
    if not vision.key_levels:
        rep.warnings.append("Model nie zwrócił żadnych kluczowych poziomów S/R.")
    if vision.pattern_at_key_level and not vision.key_levels:
        rep.warnings.append(
            "Zadeklarowano formację na kluczowym poziomie, ale nie podano żadnego poziomu S/R."
        )
    if vision.confidence < 0.5:
        rep.warnings.append(
            f"Niska pewność odczytu obrazu ({vision.confidence:.0%}) — traktuj wynik ostrożnie."
        )
    # Formacja kontrtrendowa — dozwolona, ale flagowana.
    tdir = _trend_dir(vision.trend)
    if (
        vision.pattern_direction != Direction.NONE
        and vision.trend != Trend.SIDEWAYS
        and vision.pattern_direction != tdir
    ):
        rep.warnings.append(
            "Setup kontrtrendowy — formacja przeciwna do trendu tej ramy (wg Fullera niższy priorytet)."
        )

    # Przenieś ostrzeżenia z modułu SL/TP.
    rep.warnings.extend(sltp.warnings)
    return rep
