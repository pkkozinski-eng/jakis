from app.schemas import Direction, Pattern
from app.sltp import compute_sltp
from app.validation import validate
from tests.factories import make_vision


def test_valid_setup_no_errors():
    v = make_vision()
    rep = validate(v, compute_sltp(v))
    assert rep.ok
    assert not rep.errors


def test_pattern_without_direction_is_error():
    v = make_vision(pattern=Pattern.PIN_BAR, pattern_direction=Direction.NONE,
                    nearest_target_level=None)
    rep = validate(v, compute_sltp(v))
    assert not rep.ok
    assert any("sprzeczne" in e for e in rep.errors)


def test_bullish_extreme_above_price_is_error():
    # ekstremum longa powyżej ceny -> niespójne
    v = make_vision(current_price=1.0835, pattern_extreme=1.0900)
    rep = validate(v, compute_sltp(v))
    assert not rep.ok


def test_counter_trend_warning():
    v = make_vision(trend="niedzwiedzi")
    rep = validate(v, compute_sltp(v))
    assert rep.ok  # dozwolone
    assert any("kontrtrend" in w.lower() for w in rep.warnings)


def test_low_confidence_warns():
    v = make_vision(confidence=0.3)
    rep = validate(v, compute_sltp(v))
    assert any("pewność" in w.lower() for w in rep.warnings)
