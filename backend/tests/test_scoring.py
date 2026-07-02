from app.schemas import Direction, Pattern, Trend
from app.scoring import compute_score
from app.sltp import compute_sltp
from tests.factories import make_vision


def _score(v):
    s = compute_sltp(v)
    return compute_score(v, s)


def test_perfect_bullish_setup_scores_high():
    v = make_vision()  # trend byczy + pin bar byczy na wsparciu + MTF byczy + R:R ok
    factors, raw, mx, score = _score(v)
    assert score >= 7  # powyżej progu wejścia
    # wszystkie 5 czynników stosowalnych (MTF dostępne)
    assert len(factors) == 5
    assert all(f.applicable for f in factors)


def test_counter_trend_scores_lower():
    v = make_vision(trend=Trend.BEARISH, higher_tf_trend=Trend.BEARISH)
    # formacja byczy przeciwna do trendu niedźwiedziego
    _, _, _, score = _score(v)
    assert score < 7


def test_pattern_off_level_penalized():
    aligned = _score(make_vision())[3]
    off = _score(make_vision(pattern_at_key_level=False))[3]
    assert off < aligned


def test_missing_mtf_is_excluded_from_normalization():
    v = make_vision(higher_tf_trend=None)
    factors, raw, mx, score = _score(v)
    mtf = next(f for f in factors if "multi-timeframe" in f.name.lower())
    assert mtf.applicable is False
    # max punktów bez MTF = 8 (3+2+2+1)
    assert mx == 8
    # nadal wysoki wynik znormalizowany
    assert score >= 7


def test_no_pattern_zero_quality():
    v = make_vision(pattern=Pattern.NONE, pattern_direction=Direction.NONE,
                    pattern_at_key_level=False, nearest_target_level=None)
    factors, _, _, score = _score(v)
    quality = next(f for f in factors if "Jakość" in f.name)
    assert quality.points == 0


def test_repeatability_same_input_same_score():
    v = make_vision()
    assert _score(v)[3] == _score(v)[3]


def test_score_in_range():
    for q in range(0, 11):
        v = make_vision(pattern_quality=q)
        _, _, _, score = _score(v)
        assert 1 <= score <= 10


def test_low_quality_pattern_drops_below_threshold():
    v = make_vision(pattern_quality=2, pattern_at_key_level=False)
    _, _, _, score = _score(v)
    assert score < 7
