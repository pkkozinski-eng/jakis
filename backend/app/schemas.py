"""Pydantic schemas — sztywne kontrakty JSON dla obu warstw analizy.

Warstwa 1 (VisionAnalysis): to, co model wizyjny MUSI zwrócić — walidowane tutaj.
Warstwa 2 (AnalysisResult): finalny wynik po przeliczeniu reguł w kodzie.

Cała komunikacja z modelem jest wymuszona przez ten schemat — jeśli model
zwróci dane niekompletne lub sprzeczne, walidacja Pydantic je odrzuci, a backend
zwróci błąd/ostrzeżenie zamiast zgadywać (sekcja 2 wymagań).
"""
from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


# --------------------------------------------------------------------------- #
#  Wspólne typy wyliczeniowe
# --------------------------------------------------------------------------- #
class Trend(str, Enum):
    BULLISH = "byczy"
    BEARISH = "niedzwiedzi"
    SIDEWAYS = "boczny"


class Direction(str, Enum):
    """Kierunek formacji / potencjalnego wejścia."""
    BULLISH = "byczy"
    BEARISH = "niedzwiedzi"
    NONE = "brak"


class Pattern(str, Enum):
    PIN_BAR = "pin_bar"
    ENGULFING = "engulfing"
    INSIDE_BAR = "inside_bar"
    FAKEY = "fakey"
    NONE = "brak"


class LevelType(str, Enum):
    SUPPORT = "wsparcie"
    RESISTANCE = "opor"


class Verdict(str, Enum):
    ENTER = "WCHODZE"
    SKIP = "NIE WCHODZE"


# --------------------------------------------------------------------------- #
#  Warstwa 1 — surowy odczyt obrazu przez Claude Vision
# --------------------------------------------------------------------------- #
class KeyLevel(BaseModel):
    """Kluczowy poziom S/R odczytany z wykresu."""
    price: float = Field(..., description="Cena poziomu")
    type: LevelType
    strength: int = Field(
        ..., ge=1, le=3,
        description="Siła poziomu: 1=słaby, 2=średni, 3=silny (wielokrotnie testowany)",
    )


class VisionAnalysis(BaseModel):
    """Ustrukturyzowany odczyt wykresu. To wypełnia model wizyjny.

    UWAGA: model NIE wystawia tu końcowego score 1-10 — od tego jest warstwa 2.
    ``pattern_quality`` to jedynie surowa ocena czystości samej świecy.
    """
    # Kontekst
    pair: str = Field(..., description="Para walutowa, np. EUR/USD")
    timeframe: str = Field(..., description="Rama czasowa, np. D1/H4/H1")

    # Struktura trendu
    trend: Trend = Field(..., description="Kierunek trendu na tej ramie")
    trend_structure: str = Field(
        ..., description="Opis struktury: układ HH/HL (byczy) lub LH/LL (niedźwiedzi)"
    )
    price_vs_levels: str = Field(
        ..., description="Pozycja ceny względem kluczowych poziomów S/R"
    )
    dema_configuration: Optional[str] = Field(
        None, description="Układ DEMA 20/50 jeśli widoczny (nad/pod, zbieżność), inaczej null"
    )

    # Formacja świecowa
    pattern: Pattern = Field(..., description="Rozpoznana formacja price action")
    pattern_direction: Direction = Field(
        ..., description="Kierunek sygnału formacji (byczy/niedźwiedzi/brak)"
    )
    pattern_quality: int = Field(
        ..., ge=0, le=10,
        description="Czystość samej formacji 0-10 (długość cienia, korpus, zamknięcie). "
                    "To NIE jest końcowy score.",
    )
    pattern_at_key_level: bool = Field(
        ..., description="Czy formacja występuje na kluczowym poziomie S/R / strefie"
    )

    # Poziomy i ceny do wyliczenia SL/TP
    key_levels: List[KeyLevel] = Field(default_factory=list)
    current_price: float = Field(..., description="Aktualna cena / cena wejścia")
    pattern_extreme: float = Field(
        ..., description="Ekstremum formacji (dołek pin bara dla longa / szczyt dla shorta) — baza dla SL"
    )
    nearest_target_level: Optional[float] = Field(
        None, description="Najbliższy istotny poziom S/R w kierunku sygnału — baza dla TP (null jeśli brak)"
    )

    # Multi-timeframe (opcjonalne — tylko gdy w kadrze widać wyższą ramę / opis)
    higher_tf_trend: Optional[Trend] = Field(
        None, description="Trend wyższej ramy czasowej jeśli znany, inaczej null"
    )

    # Meta
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Pewność odczytu obrazu przez model (0-1)"
    )
    notes: str = Field("", description="Dodatkowe obserwacje modelu")

    @field_validator("pair")
    @classmethod
    def _normalize_pair(cls, v: str) -> str:
        return v.strip().upper().replace("-", "/")


# --------------------------------------------------------------------------- #
#  Warstwa 2 — wynik przeliczony regułami w kodzie
# --------------------------------------------------------------------------- #
class ScoreFactor(BaseModel):
    """Pojedynczy czynnik scoringu z punktacją cząstkową."""
    name: str
    points: float
    max_points: float
    applicable: bool = True
    rationale: str


class SLTP(BaseModel):
    """Wyliczony Stop Loss / Take Profit / R:R."""
    entry: float
    stop_loss: float
    take_profit: Optional[float] = None
    risk: float
    reward: Optional[float] = None
    rr: Optional[float] = Field(None, description="Reward/Risk, np. 2.5 oznacza 1:2.5")
    rr_ok: bool = Field(False, description="Czy R:R >= 1:2")
    warnings: List[str] = Field(default_factory=list)


class FundamentalContext(BaseModel):
    """Kontekst makroekonomiczny / fundamentalny dla pary."""
    base_ccy: str
    quote_ccy: str
    base_rate: Optional[float] = Field(None, description="Stopa procentowa waluty bazowej (%)")
    quote_rate: Optional[float] = Field(None, description="Stopa procentowa waluty kwotowanej (%)")
    rate_differential: Optional[float] = Field(
        None, description="Różnica stóp (base - quote) w p.p."
    )
    carry_bias: Direction = Field(
        Direction.NONE, description="Kierunek preferowany przez różnicę stóp (carry)"
    )
    fundamental_bias: Direction = Field(
        Direction.NONE, description="Zagregowane nastawienie fundamentalne dla pary"
    )
    alignment: str = Field(
        "brak_danych",
        description="Zgodność sygnału technicznego z fundamentami: zgodny/przeciwny/neutralny/brak_danych",
    )
    high_impact_event_warning: Optional[str] = Field(
        None, description="Ostrzeżenie o nadchodzącym wydarzeniu wysokiej wagi (NFP/CPI/decyzja stóp)"
    )
    notes: List[str] = Field(default_factory=list)
    source: str = Field("static", description="Źródło danych: 'live' (FRED/web) lub 'static' (tabela wbudowana)")
    as_of: str = Field(..., description="Data aktualności danych fundamentalnych")


class AnalysisResult(BaseModel):
    """Finalny, sztywny format wyniku (sekcja 6). Backend go wymusza i waliduje."""
    id: Optional[int] = None
    created_at: Optional[str] = None

    pair: str
    timeframe: str
    trend: Trend
    pattern: Pattern
    pattern_direction: Direction

    factors: List[ScoreFactor]
    raw_points: float
    max_points: float
    score: int = Field(..., ge=1, le=10, description="Końcowy wynik 1-10 (znormalizowany)")

    verdict: Verdict
    threshold: int = 7

    sltp: SLTP
    fundamentals: FundamentalContext

    reasoning: str = Field(..., description="Uzasadnienie po polsku")
    warnings: List[str] = Field(default_factory=list)
    vision_confidence: float
    disclaimer: str = Field(
        default=(
            "To narzędzie wspiera decyzję i NIE stanowi porady inwestycyjnej. "
            "Analiza opiera się na automatycznym odczycie obrazu i regułach — może zawierać błędy. "
            "Handel na rynku forex wiąże się z wysokim ryzykiem straty kapitału. "
            "Ostateczna decyzja i odpowiedzialność należą wyłącznie do użytkownika."
        )
    )
