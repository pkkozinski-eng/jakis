from app.schemas import Direction, Pattern
from app.sltp import compute_sltp
from tests.factories import make_vision


def test_bullish_sltp_and_rr():
    v = make_vision()  # long, extreme 1.0808, entry 1.0835, target 1.0895
    s = compute_sltp(v, min_rr=2.0, buffer_pct=0.001)
    assert s.stop_loss < s.entry < s.take_profit
    # risk ~ 0.0027 + buffer; reward 0.006; R:R powinien być >= 2
    assert s.rr is not None and s.rr >= 2.0
    assert s.rr_ok is True
    assert not s.warnings


def test_bearish_sltp_sides():
    v = make_vision(
        trend="niedzwiedzi",
        pattern_direction=Direction.BEARISH,
        current_price=1.0835,
        pattern_extreme=1.0860,
        nearest_target_level=1.0750,
        higher_tf_trend="niedzwiedzi",
    )
    s = compute_sltp(v)
    assert s.stop_loss > s.entry > s.take_profit
    assert s.rr_ok is True


def test_missing_target_flags_risk():
    v = make_vision(nearest_target_level=None)
    s = compute_sltp(v)
    assert s.take_profit is None
    assert s.rr is None
    assert s.rr_ok is False
    assert any("R:R" in w for w in s.warnings)


def test_low_rr_flagged():
    # cel bardzo blisko -> R:R < 2
    v = make_vision(current_price=1.0835, pattern_extreme=1.0808, nearest_target_level=1.0845)
    s = compute_sltp(v, min_rr=2.0)
    assert s.rr_ok is False
    assert any("poniżej wymaganego" in w for w in s.warnings)


def test_no_direction_returns_flat():
    v = make_vision(pattern=Pattern.NONE, pattern_direction=Direction.NONE,
                    pattern_at_key_level=False, nearest_target_level=None)
    s = compute_sltp(v)
    assert s.take_profit is None
    assert s.rr is None


def test_jpy_rounding():
    v = make_vision(pair="USD/JPY", current_price=155.55, pattern_extreme=155.05,
                    nearest_target_level=156.60,
                    key_levels=[])
    s = compute_sltp(v)
    # 3 miejsca po przecinku dla JPY
    assert round(s.stop_loss, 3) == s.stop_loss
