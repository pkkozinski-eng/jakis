"""Warstwa fundamentalna / makroekonomiczna (rozszerzenie wymagań).

Sprawdza aktualną sytuację fundamentalną pary walutowej i nakłada ją na sygnał
techniczny jako KONTEKST i OSTRZEŻENIE — nie nadpisuje technicznego score
(to zachowuje powtarzalność warstwy technicznej). Fundamenty mogą jednak:
  * dać ostrzeżenie o konflikcie technika vs makro,
  * zablokować werdykt przy nadchodzącym wydarzeniu wysokiej wagi (np. NFP/decyzja stóp).

Źródła danych:
  * 'static' — wbudowana tabela referencyjna (stopy, nastawienie banków) — zawsze dostępna.
  * 'live'   — próba odświeżenia kluczowych stóp z FRED API, gdy ustawiono FRED_API_KEY.
Tabela statyczna wymaga okresowej ręcznej aktualizacji — data w polu ``as_of``.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Optional

from .config import Settings
from .schemas import Direction, FundamentalContext

# Data aktualności tabeli statycznej — AKTUALIZUJ ręcznie przy przeglądzie.
STATIC_AS_OF = "2026-06"

# Referencyjne stopy polityki pieniężnej (%) i nastawienie banku centralnego.
# UWAGA: wartości orientacyjne — przed realnym tradem zweryfikuj u źródła.
@dataclass(frozen=True)
class CcyProfile:
    rate: float
    stance: str          # opis nastawienia (hawkish/dovish/neutralny)
    stance_bias: Direction  # jak nastawienie działa na SIŁĘ tej waluty


STATIC_TABLE: dict[str, CcyProfile] = {
    "USD": CcyProfile(4.25, "restrykcyjny hold, uzależniony od danych inflacyjnych", Direction.BULLISH),
    "EUR": CcyProfile(2.15, "neutralny, cykl obniżek zakończony", Direction.NONE),
    "GBP": CcyProfile(4.00, "łagodzenie, przestrzeń do obniżek", Direction.BEARISH),
    "JPY": CcyProfile(0.50, "stopniowa normalizacja, lekko jastrzębi", Direction.BULLISH),
    "CHF": CcyProfile(0.25, "neutralny, niska inflacja", Direction.NONE),
    "AUD": CcyProfile(3.60, "neutralny, zależny od Chin i surowców", Direction.NONE),
    "CAD": CcyProfile(2.75, "neutralny", Direction.NONE),
    "NZD": CcyProfile(3.00, "łagodny", Direction.BEARISH),
}

# Progi interpretacji różnicy stóp (carry).
CARRY_THRESHOLD = 0.5  # p.p.


def split_pair(pair: str) -> tuple[str, str]:
    """'EUR/USD' -> ('EUR', 'USD'). Obsługuje też format bez separatora (6 znaków)."""
    p = pair.strip().upper().replace("-", "/").replace(" ", "")
    if "/" in p:
        base, quote = p.split("/", 1)
    elif len(p) == 6:
        base, quote = p[:3], p[3:]
    else:
        base, quote = p[:3], p[3:] or "USD"
    return base, quote


def _next_first_friday(today: dt.date) -> dt.date:
    """Zwraca datę najbliższego pierwszego piątku miesiąca (przybliżenie NFP)."""
    def first_friday(year: int, month: int) -> dt.date:
        d = dt.date(year, month, 1)
        # weekday(): pon=0 ... pt=4
        offset = (4 - d.weekday()) % 7
        return d + dt.timedelta(days=offset)

    ff = first_friday(today.year, today.month)
    if ff < today:
        nm_year = today.year + (1 if today.month == 12 else 0)
        nm_month = 1 if today.month == 12 else today.month + 1
        ff = first_friday(nm_year, nm_month)
    return ff


def _high_impact_warning(base: str, quote: str, today: dt.date) -> Optional[str]:
    """Heurystyka statyczna: ostrzega o zbliżającym się NFP (USD) w oknie 2 dni."""
    if "USD" in (base, quote):
        ff = _next_first_friday(today)
        days = (ff - today).days
        if 0 <= days <= 2:
            return (
                f"Zbliża się NFP (payrolls USA) ~{ff.isoformat()} — wysoka zmienność na parach USD. "
                f"Fuller: unikaj wchodzenia tuż przed publikacją wysokiej wagi."
            )
    return None


def _try_live_rates(settings: Settings, base: str, quote: str) -> dict[str, float]:
    """Best-effort odświeżenie stóp z FRED. Zwraca tylko waluty, które się udało pobrać."""
    if not settings.fred_api_key:
        return {}
    series = {"USD": "FEDFUNDS", "EUR": "ECBDFR"}  # rozszerzalne
    out: dict[str, float] = {}
    try:
        import httpx  # lokalny import — moduł działa też bez httpx w trybie static
    except Exception:
        return {}
    for ccy in {base, quote}:
        sid = series.get(ccy)
        if not sid:
            continue
        try:
            resp = httpx.get(
                "https://api.stlouisfed.org/fred/series/observations",
                params={
                    "series_id": sid,
                    "api_key": settings.fred_api_key,
                    "file_type": "json",
                    "sort_order": "desc",
                    "limit": 1,
                },
                timeout=6.0,
            )
            resp.raise_for_status()
            obs = resp.json().get("observations", [])
            if obs and obs[0].get("value") not in (None, ".", ""):
                out[ccy] = float(obs[0]["value"])
        except Exception:
            continue
    return out


def get_fundamentals(
    pair: str,
    technical_direction: Direction,
    settings: Settings,
    *,
    today: Optional[dt.date] = None,
) -> FundamentalContext:
    """Buduje kontekst fundamentalny dla pary i porównuje go z sygnałem technicznym."""
    today = today or dt.date.today()
    base, quote = split_pair(pair)

    base_prof = STATIC_TABLE.get(base)
    quote_prof = STATIC_TABLE.get(quote)
    notes: list[str] = []

    # Live override (jeśli dostępne).
    live = _try_live_rates(settings, base, quote)
    source = "static"
    base_rate = base_prof.rate if base_prof else None
    quote_rate = quote_prof.rate if quote_prof else None
    if base in live:
        base_rate, source = live[base], "live"
    if quote in live:
        quote_rate, source = live[quote], "live"

    if base_prof is None:
        notes.append(f"Brak danych fundamentalnych dla waluty {base} — użyto neutralnego założenia.")
    if quote_prof is None:
        notes.append(f"Brak danych fundamentalnych dla waluty {quote} — użyto neutralnego założenia.")

    # Różnica stóp i bias carry.
    rate_diff: Optional[float] = None
    carry_bias = Direction.NONE
    if base_rate is not None and quote_rate is not None:
        rate_diff = round(base_rate - quote_rate, 2)
        if rate_diff >= CARRY_THRESHOLD:
            carry_bias = Direction.BULLISH
            notes.append(
                f"Dodatni carry: {base} ({base_rate}%) wyżej oprocentowany niż {quote} ({quote_rate}%) "
                f"o {rate_diff} p.p. — sprzyja sile {base}."
            )
        elif rate_diff <= -CARRY_THRESHOLD:
            carry_bias = Direction.BEARISH
            notes.append(
                f"Ujemny carry: {quote} ({quote_rate}%) wyżej oprocentowany niż {base} ({base_rate}%) "
                f"o {abs(rate_diff)} p.p. — sprzyja słabości {base}."
            )
        else:
            notes.append(f"Różnica stóp niewielka ({rate_diff} p.p.) — carry neutralny.")

    # Zagregowane nastawienie fundamentalne = carry + nastawienie banków (relatywnie).
    fundamental_bias = _aggregate_bias(carry_bias, base_prof, quote_prof, notes)

    # Zgodność z technicznym kierunkiem.
    alignment = _alignment(technical_direction, fundamental_bias)

    warning = _high_impact_warning(base, quote, today)

    return FundamentalContext(
        base_ccy=base,
        quote_ccy=quote,
        base_rate=base_rate,
        quote_rate=quote_rate,
        rate_differential=rate_diff,
        carry_bias=carry_bias,
        fundamental_bias=fundamental_bias,
        alignment=alignment,
        high_impact_event_warning=warning,
        notes=notes,
        source=source,
        as_of=STATIC_AS_OF if source == "static" else today.isoformat(),
    )


def _aggregate_bias(
    carry_bias: Direction,
    base_prof: Optional[CcyProfile],
    quote_prof: Optional[CcyProfile],
    notes: list[str],
) -> Direction:
    """Łączy carry z nastawieniem banków centralnych na siłę bazy vs kwotowanej."""
    score = 0
    if carry_bias == Direction.BULLISH:
        score += 2
    elif carry_bias == Direction.BEARISH:
        score -= 2

    # Nastawienie banku bazowego wzmacnia/osłabia bazę.
    if base_prof:
        if base_prof.stance_bias == Direction.BULLISH:
            score += 1
        elif base_prof.stance_bias == Direction.BEARISH:
            score -= 1
    # Nastawienie banku kwotowanego działa odwrotnie na parę.
    if quote_prof:
        if quote_prof.stance_bias == Direction.BULLISH:
            score -= 1
        elif quote_prof.stance_bias == Direction.BEARISH:
            score += 1

    if base_prof:
        notes.append(f"Nastawienie banku {base_prof.stance_bias.value if base_prof else ''}: {base_prof.stance}.")
    if score >= 2:
        return Direction.BULLISH
    if score <= -2:
        return Direction.BEARISH
    return Direction.NONE


def _alignment(technical: Direction, fundamental: Direction) -> str:
    if fundamental == Direction.NONE or technical == Direction.NONE:
        return "neutralny"
    return "zgodny" if technical == fundamental else "przeciwny"
