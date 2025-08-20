from __future__ import annotations
from typing import List, Dict, Any
import math

EPS = 1e-9

def moving_average(units: List[float], window: int) -> float:
    if not units:
        return 0.0
    # take the most recent `window` points (list is already a time slice)
    slice_ = units[-window:] if len(units) >= window else units
    return sum(slice_) / max(1, len(slice_))

def ceil_to_multiple(x: float, multiple: int) -> int:
    if multiple <= 1:
        return math.ceil(max(0.0, x))
    return int(math.ceil(max(0.0, x) / multiple) * multiple)

def compute_features(
    on_hand: float,
    last_n_units: List[float],
    lead_time_days: float,
    safety_buffer_days: float,
    velocity_window_days: int,
    open_pos: List[Dict[str, Any]],
) -> Dict[str, float]:
    velocity = moving_average(last_n_units, velocity_window_days)
    eff_vel = max(velocity, EPS)
    doc = on_hand / eff_vel

    need_days = float(lead_time_days) + float(safety_buffer_days)
    rop = eff_vel * need_days

    # incoming arriving within lead time window (simplified: all arrive by LT)
    incoming_within_lt = sum(po.get("qty", 0) for po in open_pos if po.get("qty", 0) > 0)

    # risk (0..100)
    if eff_vel <= EPS:
        risk = 0
    else:
        cover_gap = max(0.0, need_days - doc) / max(need_days, EPS)
        risk = round(100 * min(1.0, cover_gap))

    return {
        "velocity_per_day": float(velocity),
        "doc_days": float(doc),
        "need_days": float(need_days),
        "rop_units": float(rop),
        "incoming_within_lt": float(incoming_within_lt),
        "risk": float(risk),
    }

def propose_replenishment(
    on_hand: float,
    features: Dict[str, float],
    reorder_multiple: int,
    min_order_qty: int,
    max_order_qty: int,
):
    target_stock = features["rop_units"] + features["need_days"] * max(features["velocity_per_day"], EPS)
    order_qty_raw = target_stock - (on_hand + features["incoming_within_lt"])
    order_qty = ceil_to_multiple(order_qty_raw, reorder_multiple)
    order_qty = int(max(min_order_qty, min(order_qty, max_order_qty)))
    return max(0, order_qty)
