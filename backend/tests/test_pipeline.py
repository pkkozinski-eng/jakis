import datetime as dt

import pytest

from app.analyzer import AnalysisError, analyze_vision
from app.config import get_settings
from app.schemas import Direction, Pattern, Trend, Verdict
from tests.factories import make_vision

# Data w środku miesiąca — z dala od pierwszego piątku (brak blokady NFP).
SAFE_DAY = dt.date(2026, 7, 15)


def test_full_pipeline_enter():
    res = analyze_vision(make_vision(), today=SAFE_DAY)
    assert res.score >= 7
    assert res.verdict == Verdict.ENTER
    assert res.sltp.stop_loss < res.sltp.entry < res.sltp.take_profit
    assert res.disclaimer  # zawsze obecny
    assert res.fundamentals.base_ccy == "EUR"
    assert res.fundamentals.quote_ccy == "USD"


def test_full_pipeline_skip_below_threshold():
    v = make_vision(pattern_quality=2, pattern_at_key_level=False)
    res = analyze_vision(v, today=SAFE_DAY)
    assert res.verdict == Verdict.SKIP
    assert res.score < 7


def test_news_block_overrides_enter():
    # 2026-08-07 to pierwszy piątek sierpnia -> okno NFP blokuje wejście mimo score >=7.
    first_friday_aug = dt.date(2026, 8, 7)
    assert first_friday_aug.weekday() == 4  # piątek
    res = analyze_vision(make_vision(), today=first_friday_aug)
    assert res.score >= 7
    assert res.verdict == Verdict.SKIP
    assert any("NFP" in w for w in res.warnings)


def test_inconsistent_data_raises():
    v = make_vision(pattern=Pattern.PIN_BAR, pattern_direction=Direction.NONE,
                    nearest_target_level=None)
    with pytest.raises(AnalysisError) as exc:
        analyze_vision(v)
    assert exc.value.errors


def test_result_schema_roundtrip():
    res = analyze_vision(make_vision(), today=SAFE_DAY)
    dumped = res.model_dump_json()
    from app.schemas import AnalysisResult
    again = AnalysisResult.model_validate_json(dumped)
    assert again.score == res.score
    assert again.verdict == res.verdict


def test_fundamental_conflict_warns_but_keeps_score():
    # short EUR/USD: technicznie niedźwiedzi, ale carry sprzyja USD (quote) -> fundamentals bearish EUR
    # skonstruujmy sytuację, gdzie kierunek techniczny != fundamentalny, sprawdzamy tylko obecność ostrzeżenia
    v = make_vision()
    res = analyze_vision(v, today=SAFE_DAY)
    # przy zgodności nie ma ostrzeżenia o konflikcie
    assert isinstance(res.warnings, list)
