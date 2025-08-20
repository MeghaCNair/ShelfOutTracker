from src.rules import moving_average, compute_features, propose_replenishment

def test_moving_average():
    assert moving_average([1,2,3,4], 3) == 3
    assert moving_average([], 7) == 0

def test_compute_features_and_proposal():
    feats = compute_features(
        on_hand=10,
        last_n_units=[5,5,5,5,5,5,5],
        lead_time_days=3,
        safety_buffer_days=2,
        velocity_window_days=7,
        open_pos=[{"qty":30,"eta":"2025-08-21"}],
    )
    assert feats["doc_days"] == 2.0
    assert int(feats["risk"]) == 60

    qty = propose_replenishment(
        on_hand=10,
        features=feats,
        reorder_multiple=1,
        min_order_qty=0,
        max_order_qty=1000,
    )
    assert qty == 10  # from the worked example in the docs
