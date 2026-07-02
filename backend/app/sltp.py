"""Wyliczanie Stop Loss / Take Profit / R:R — czysta, testowalna logika (warstwa 2).

Zasady (sekcja 5 wymagań):
  * SL za ekstremum formacji + bufor.
  * TP na najbliższym istotnym poziomie S/R w kierunku sygnału.
  * R:R wyliczony jawnie; jeśli struktura nie daje TP dającego min. R:R — oznacz ryzyko.
"""
from __future__ import annotations

from typing import Optional

from .schemas import Direction, SLTP, VisionAnalysis


def _round_price(pair: str, value: float) -> float:
    """Zaokrągla cenę do liczby miejsc typowej dla pary (JPY: 3, reszta: 5)."""
    decimals = 3 if "JPY" in pair.upper() else 5
    return round(value, decimals)


def compute_sltp(
    vision: VisionAnalysis,
    *,
    min_rr: float = 2.0,
    buffer_pct: float = 0.1,
) -> SLTP:
    """Liczy SL/TP/RR na podstawie odczytu obrazu.

    Zwraca obiekt SLTP z listą ostrzeżeń, jeśli czegoś brakuje albo R:R < min.
    Nie zgaduje TP — jeśli model nie podał poziomu docelowego, TP pozostaje pusty.
    """
    warnings: list[str] = []
    entry = vision.current_price
    extreme = vision.pattern_extreme
    # Bufor za ekstremum jako ułamek dystansu wejście-ekstremum (skaluje się z formacją).
    buffer = abs(entry - extreme) * buffer_pct

    direction = vision.pattern_direction

    if direction == Direction.BULLISH:
        stop_loss = extreme - buffer
    elif direction == Direction.BEARISH:
        stop_loss = extreme + buffer
    else:
        # Brak kierunku formacji — nie da się sensownie ustawić SL/TP.
        return SLTP(
            entry=_round_price(vision.pair, entry),
            stop_loss=_round_price(vision.pair, entry),
            take_profit=None,
            risk=0.0,
            reward=None,
            rr=None,
            rr_ok=False,
            warnings=["Brak kierunku formacji — nie można wyznaczyć SL/TP."],
        )

    risk = abs(entry - stop_loss)
    if risk <= 0:
        warnings.append("Ryzyko (odległość do SL) wychodzi zerowe lub ujemne — sprawdź poziomy.")

    take_profit = vision.nearest_target_level
    reward: Optional[float] = None
    rr: Optional[float] = None
    rr_ok = False

    if take_profit is None:
        warnings.append(
            "Brak najbliższego istotnego poziomu docelowego (TP) — struktura rynku nie daje "
            "jasnego celu. RYZYKO: nie można potwierdzić R:R >= 1:2."
        )
    else:
        # TP musi leżeć po właściwej stronie wejścia.
        tp_valid = (
            (direction == Direction.BULLISH and take_profit > entry)
            or (direction == Direction.BEARISH and take_profit < entry)
        )
        if not tp_valid:
            warnings.append(
                "Podany poziom docelowy leży po złej stronie ceny względem kierunku sygnału — TP odrzucony."
            )
            take_profit = None
        else:
            reward = abs(take_profit - entry)
            rr = round(reward / risk, 2) if risk > 0 else None
            if rr is not None:
                rr_ok = rr >= min_rr
                if not rr_ok:
                    warnings.append(
                        f"R:R wynosi 1:{rr:.2f}, poniżej wymaganego minimum 1:{min_rr:.0f}. "
                        f"Cel zbyt blisko względem ryzyka."
                    )

    return SLTP(
        entry=_round_price(vision.pair, entry),
        stop_loss=_round_price(vision.pair, stop_loss),
        take_profit=_round_price(vision.pair, take_profit) if take_profit is not None else None,
        risk=round(risk, 5),
        reward=round(reward, 5) if reward is not None else None,
        rr=rr,
        rr_ok=rr_ok,
        warnings=warnings,
    )
