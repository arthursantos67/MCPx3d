from api.timing import StageTimer


def test_stage_timer_uses_a_monotonic_clock_and_omits_unfinished_stages() -> None:
    readings = iter((10.0, 10.125, 10.2))
    timer = StageTimer(clock=lambda: next(readings))

    timer.start("provider_request")
    timer.finish("provider_request")
    timer.start("viewer_loading")

    assert timer.summary() == {"provider_request": 125}
