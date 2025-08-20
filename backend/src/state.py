from typing import TypedDict, Any, Dict, List, Optional

class State(TypedDict, total=False):
    # identifiers
    sku_id: str
    location_id: str

    # raw signals
    facts: Dict[str, Any]
    # engineered metrics
    features: Dict[str, Any]

    # decision + proposal
    decision: Dict[str, Any]
    proposal: Dict[str, Any]

    # alerts + approval
    alerts: List[Dict[str, Any]]
    approval: Dict[str, Any]

    # journaling
    journal_id: Optional[str]
