from __future__ import annotations
from typing import Dict, Any
from langgraph.graph import StateGraph, START, END

from .state import State
from .rules import compute_features, propose_replenishment
from .mcp_clients import WMSClient, POSClient, ERPClient, CatalogClient, SlackClient, JournalClient

def build_graph(policy: Dict[str, Any]):
    wms = WMSClient()
    pos = POSClient()
    erp = ERPClient()
    cat = CatalogClient()
    slack = SlackClient()
    journal = JournalClient()

    def fetch_signals(state: State) -> State:
        sku = state["sku_id"]; loc = state["location_id"]
        inv_df = wms.inventory_read(sku_id=sku, location_id=loc)
        if inv_df.empty:
            state["facts"] = {"on_hand": 0.0, "sales": [], "lead_time_days": 0.0, "open_pos": []}
            return state

        on_hand = float(inv_df.iloc[0]["on_hand"])
        last_n = pos.sales_read(sku, loc, policy["velocity_window_days"])
        supply = erp.supply_read(sku, loc)
        catalog = cat.read(sku)

        state["facts"] = {
            "on_hand": on_hand,
            "sales_last_n": last_n,
            "lead_time_days": float(supply.get("lead_time_days", 0.0)),
            "open_pos": supply.get("open_pos", []),
            "catalog": catalog,
        }
        return state

    def feature_engineer(state: State) -> State:
        f = state["facts"]
        feats = compute_features(
            on_hand=f["on_hand"],
            last_n_units=f["sales_last_n"],
            lead_time_days=f["lead_time_days"],
            safety_buffer_days=policy["safety_buffer_days"],
            velocity_window_days=policy["velocity_window_days"],
            open_pos=f["open_pos"],
        )
        state["features"] = feats
        return state

    def decide(state: State) -> State:
        f = state["facts"]; feats = state["features"]
        risk = feats["risk"]
        if risk >= policy["risk_threshold"]:
            qty = propose_replenishment(
                on_hand=f["on_hand"],
                features=feats,
                reorder_multiple=policy["reorder_multiple"],
                min_order_qty=policy["min_order_qty"],
                max_order_qty=policy["max_order_qty"],
            )
            if qty > 0:
                state["decision"] = {"action": "replenish", "risk": risk}
                state["proposal"] = {
                    "order_qty": qty,
                    "why": {
                        "doc": feats["doc_days"],
                        "need_days": feats["need_days"],
                        "velocity": feats["velocity_per_day"],
                        "incoming": feats["incoming_within_lt"],
                        "rop": feats["rop_units"]
                    }
                }
            else:
                state["decision"] = {"action": "snooze", "risk": risk}
                state["proposal"] = {"reason": "No positive qty after constraints"}
        else:
            state["decision"] = {"action": "noop", "risk": risk}
            state["proposal"] = {}
        return state

    def notify(state: State) -> State:
        if state["decision"]["action"] in ("replenish", "snooze"):
            sku = state["sku_id"]; loc = state["location_id"]
            feats = state["features"]; prop = state["proposal"]
            title = f"{sku}@{loc} — risk {int(feats['risk'])}"
            body = {
                "title": title,
                "doc_vs_need": f"DOC={feats['doc_days']:.1f}d < Need={feats['need_days']:.1f}d",
                "suggestion": f"Order {prop.get('order_qty','-')} units" if "order_qty" in prop else prop.get("reason",""),
                "why": prop.get("why", {})
            }
            res = slack.post(policy["alert_channel"], body)
            state["alerts"] = [{"channel": policy["alert_channel"], "message_id": res["message_id"], "body": body}]
        return state

    def act(state: State) -> State:
        action = state["decision"]["action"]
        if action == "replenish" and policy.get("auto_approve", True):
            sku = state["sku_id"]; loc = state["location_id"]
            qty = int(state["proposal"]["order_qty"])
            notes = f"Auto-approved by policy (risk={int(state['features']['risk'])})"
            res = erp.po_create_draft(sku, loc, qty, notes)
            state["approval"] = {"approved": True, "po_id": res["po_id"]}
        elif action == "noop":
            state["approval"] = {"approved": False, "reason": "Low risk"}
        else:
            state["approval"] = {"approved": False, "reason": state["proposal"].get("reason","snoozed")}
        return state

    def journal_node(state: State) -> State:
        j = journal.log("shelf_out_decision", state)
        state["journal_id"] = j["journal_id"]
        return state

    g = StateGraph(State)
    g.add_node("FetchSignals", fetch_signals)
    g.add_node("FeatureEngineer", feature_engineer)
    g.add_node("Decide", decide)
    g.add_node("Notify", notify)
    g.add_node("Act", act)
    g.add_node("Journal", journal_node)

    g.add_edge(START, "FetchSignals")
    g.add_edge("FetchSignals", "FeatureEngineer")
    g.add_edge("FeatureEngineer", "Decide")
    g.add_edge("Decide", "Notify")
    g.add_edge("Notify", "Act")
    g.add_edge("Act", "Journal")
    g.add_edge("Journal", END)

    return g.compile()
