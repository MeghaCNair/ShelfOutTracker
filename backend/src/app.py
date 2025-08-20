from __future__ import annotations
import argparse
import yaml
from pathlib import Path
from typing import Dict, Any

from .mcp_clients import WMSClient
from .graph import build_graph

ROOT = Path(__file__).resolve().parents[1]

def load_policy() -> Dict[str, Any]:
    policy_path = ROOT / "config" / "policy.yaml"
    return yaml.safe_load(policy_path.read_text())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Run once over current inventory")
    args = parser.parse_args()

    policy = load_policy()
    app = build_graph(policy)

    # discover sku/location pairs from inventory
    wms = WMSClient()
    df = wms.inventory_read()
    pairs = df[["sku_id","location_id"]].drop_duplicates().values.tolist()

    for sku, loc in pairs:
        state = {
            "sku_id": str(sku),
            "location_id": str(loc)
        }
        # run the graph synchronously
        _ = app.invoke(state)

    if not args.once:
        print("\nNote: this demo runs once. For scheduling, call this script hourly (cron/Task Scheduler).\n")

if __name__ == "__main__":
    main()
