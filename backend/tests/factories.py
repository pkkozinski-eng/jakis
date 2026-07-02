"""Pomocnicze budowanie obiektów VisionAnalysis do testów."""
from app.schemas import (
    Direction,
    KeyLevel,
    LevelType,
    Pattern,
    Trend,
    VisionAnalysis,
)


def make_vision(**overrides) -> VisionAnalysis:
    base = dict(
        pair="EUR/USD",
        timeframe="H4",
        trend=Trend.BULLISH,
        trend_structure="HH/HL",
        price_vs_levels="odbicie od wsparcia",
        dema_configuration="cena nad DEMA",
        pattern=Pattern.PIN_BAR,
        pattern_direction=Direction.BULLISH,
        pattern_quality=8,
        pattern_at_key_level=True,
        key_levels=[
            KeyLevel(price=1.0820, type=LevelType.SUPPORT, strength=3),
            KeyLevel(price=1.0895, type=LevelType.RESISTANCE, strength=2),
        ],
        current_price=1.0835,
        pattern_extreme=1.0808,
        nearest_target_level=1.0895,
        higher_tf_trend=Trend.BULLISH,
        confidence=0.85,
        notes="",
    )
    base.update(overrides)
    return VisionAnalysis(**base)
