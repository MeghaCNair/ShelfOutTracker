from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
import pandas as pd
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

class WMSClient:
    def inventory_read(self, sku_id: Optional[str]=None, location_id: Optional[str]=None):
        df = pd.read_csv(DATA_DIR / "inventory_snapshot.csv")
        if sku_id is not None:
            df = df[df["sku_id"] == sku_id]
        if location_id is not None:
            df = df[df["location_id"] == location_id]
        return df

class POSClient:
    def sales_read(self, sku_id: str, location_id: str, window_days: int):
        df = pd.read_csv(DATA_DIR / "sales.csv", parse_dates=["ts"])
        df = df[(df["sku_id"] == sku_id) & (df["location_id"] == location_id)]
        df = df.sort_values("ts").tail(window_days)
        return df["units_sold"].astype(float).tolist()

class ERPClient:
    def supply_read(self, sku_id: str, location_id: str):
        items = json.loads((DATA_DIR / "supply.json").read_text())
        for it in items:
            if it["sku_id"] == sku_id and it["location_id"] == location_id:
                return {
                    "lead_time_days": float(it.get("lead_time_days", 0)),
                    "open_pos": it.get("open_pos", []),
                }
        return {"lead_time_days": 0.0, "open_pos": []}

    def po_create_draft(self, sku_id: str, location_id: str, qty: int, notes: str="") -> Dict[str, Any]:
        # stub: in real life call ERP API; here we just return a fake id
        return {"po_id": f"PO-{sku_id}-{location_id}-{qty}", "status": "DRAFT", "notes": notes}

class CatalogClient:
    def read(self, sku_id: str):
        df = pd.read_csv(DATA_DIR / "catalog.csv")
        row = df[df["sku_id"] == sku_id]
        if row.empty:
            return {}
        r = row.iloc[0].to_dict()
        return r

class SlackClient:
    def post(self, channel: str, blocks: Dict[str, Any]) -> Dict[str, Any]:
        # stub -> just print and return a message id
        print(f"\n[SLACK] Channel: {channel}\nMessage:\n{blocks}\n")
        return {"message_id": f"msg-{blocks.get('title','')}"}

class JournalClient:
    def log(self, event_type: str, state_snapshot: Dict[str, Any]) -> Dict[str, Any]:
        print(f"[JOURNAL] {event_type}: sku={state_snapshot.get('sku_id')} "
              f"loc={state_snapshot.get('location_id')} risk={state_snapshot.get('features',{}).get('risk')}")
        return {"journal_id": f"jrnl-{state_snapshot.get('sku_id')}-{state_snapshot.get('location_id')}"}
