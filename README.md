### Problem Statement
**Goal:** detect products at risk of going **out‑of‑stock (OOS)** within the next 24–72 hours, then **recommend the smallest, fastest fix** (replenish qty, substitute, or de‑list), and route it for approval.

**Business impact:** fewer empty shelves (↑ revenue, ↑ customer satisfaction), lower firefighting (↑ ops efficiency), and better working capital (don’t over‑order).

---

## 2) Problem, Scope, and Definitions

### Problem

- Inventory is per‑store (or per‑FC) and sales velocity fluctuates.
- If **Days of Cover (DOC)** drops below **Lead Time (LT)** + buffer, you’re likely to stock out **before** the next replenishment arrives.
- Human teams can’t scan every SKU × location daily.

### In‑scope (MVP)

- Retail or e‑commerce with **hourly or daily POS**, **inventory snapshots**, and **lead times**.
- Single replenishment source per SKU (multi‑source is a stretch goal).
- Recommendations go to Slack/Email with **approve / snooze / reject** actions.

### Out‑of‑scope (MVP)

- Vendor negotiations, advanced demand forecasting, cross‑price cannibalization, automated PO placement without approval.

### Key terms

- **On‑hand**: current inventory units.
- **Sales velocity**: moving average units/day (per SKU/location).
- **Days of Cover (DOC)**: `on_hand / velocity`.
- **Lead Time (LT)**: days from order to available-to-sell.
- **Safety stock**: extra buffer (days or units).
- **Reorder point (ROP)**: `velocity * (LT + safety_buffer_days)`.

---

## 3) Success Metrics (KPIs)

- **OOS hours ↓** (or OOS incidents ↓) per SKU/location.
- **Fill rate ↑**.
- **Alert precision/recall** (true issues caught / false alarms).
- **Approval lead time ↓** (time from alert → decision).
- **Recovery value** (sales saved vs control).

**Acceptance criteria (MVP):**

- ≥ 90% of true OOS cases flagged **≥ 24h** in advance.
- ≤ 20% false positives (tunable).
- End‑to‑end alert → approval → action in **< 10 minutes**.

---

## 4) Inputs & Minimal Data Contracts

You can source these via MCP server endpoints (see §7).

| Data | Minimal fields | Frequency |
| --- | --- | --- |
| Inventory snapshot | `sku_id, location_id, on_hand, last_updated` | Hourly/daily |
| Sales | `sku_id, location_id, units_sold, ts` | Hourly/daily |
| Catalog | `sku_id, pack_size(optional), uom, substitution_group_id(optional)` | Static |
| Supply | `sku_id, location_id, lead_time_days, open_pos[] (qty, eta)` | Daily |
| Policy/Config | `safety_buffer_days, min_order_qty, max_order_qty, reorder_multiple` | Static/env |

> Assumption: sales >= 0, on_hand >= 0; if velocity ~ 0, handle divide‑by‑zero with guards (DOC = ∞).
> 

---

## 5) Core Logic (How we tackle it)

### 5.1 Compute rolling velocity

- Use a **7‑day** (default) moving average per `sku_id, location_id`.
- For highly seasonal SKUs, use **weighted recent days**: e.g., weight today ×3.

### 5.2 Project stockout risk

1. **Days of Cover**: `DOC = on_hand / max(velocity, ε)`.
2. **Time to OOS** (hours or days): if velocity > 0, `tt_oos = DOC`.
3. **Incoming supply**: fold in open POs that land before `tt_oos`.
    - If `sum(incoming_before_ttoos) >= ROP`, risk decreases.

### 5.3 Risk score & decision rule (MVP, rules‑based)

- **Risk score** (0–100):
    
    ```
    need_days = lead_time_days + safety_buffer_days
    if velocity <= ε:
        risk = 0
    else:
        cover_gap = max(0, need_days - DOC) / need_days
        risk = round(100 * min(1.0, cover_gap))
    
    ```
    
- **Trigger if** `risk ≥ RISK_THRESHOLD` (e.g., 60).

### 5.4 Suggested action (in order)

1. **Replenish**: `order_qty = ceil((ROP + target_cover_days*velocity) - (on_hand + incoming_within_LT))`
    - Snap to `reorder_multiple`, clamp to `[min_order_qty, max_order_qty]`.
2. **Substitute** (if supplier constraint or long LT):
    - Choose SKU from same `substitution_group_id` with `on_hand` and similar price.
3. **De‑list or Snooze** (optional):
    - If sustained low velocity, suggest de‑listing or snooze alert.

### 5.5 Human‑in‑the‑loop

- Send Slack card: **SKU**, **location**, **risk**, **why**, **order suggestion**.
- Buttons: **Approve** (create PO draft), **Snooze (24h)**, **Reject** (give reason).
- Journal every action for auditability.

---

## 6) System Architecture (Agentic)

### 6.1 LangGraph State & Nodes

**State (TypedDict):**

- `facts`: raw fetched signals (inventory, velocity, LT, open_pos)
- `features`: computed metrics (DOC, ROP, risk, order_qty)
- `decision`: `{action: 'replenish'|'substitute'|'snooze'|'reject', rationale: str}`
- `proposal`: payload for action (PO draft or substitution recs)
- `alerts`: list of alert messages
- `approval`: `{approved: bool, approver: str, ts: str}`
- `journal_id`: audit key

**Node pipeline (happy path):**

1. **FetchSignals** → pull inventory, sales, supply, config
2. **FeatureEngineer** → velocity, DOC, ROP, risk
3. **Decide** → pick action & build proposal
4. **Notify** → send Slack/Email with approve/snooze/reject buttons
5. **AwaitApproval** → (edge routed by callback payload)
6. **Act** → e.g., create PO draft / create task / write plan
7. **Journal** → persist event log + metrics

**Edges:**

`START → FetchSignals → FeatureEngineer → Decide → Notify → AwaitApproval → Act → Journal → END`

> Note: “AwaitApproval” is event‑driven: MCP webhook/callback resumes the graph with user input.
> 

### 6.2 MCP Server Endpoints (example contracts)

*Read:*

- `wms.inventory.read { sku_id?, location_id?, since? } → [{sku_id, location_id, on_hand, ts}]`
- `pos.sales.read { sku_id?, location_id?, window_days } → [{sku_id, location_id, ts, units}]`
- `erp.supply.read { sku_id?, location_id? } → {lead_time_days, open_pos:[{qty, eta}]}`
- `catalog.read { sku_id? } → {sku_id, substitution_group_id, pack_size?, uom}`

*Write/Action:*

- `erp.po.create_draft { sku_id, location_id, qty, notes } → {po_id, status}`
- `slack.post { channel, blocks } → {ts, message_id}`
- `journal.log { event_type, state_snapshot } → {journal_id}`

*Callback (from Slack interactivity):*

- `approval.callback { message_id, action, user, notes? } → {status}`

---

## 7) Configuration (env / policy)

- `RISK_THRESHOLD=60`
- `SAFETY_BUFFER_DAYS=2`
- `VELOCITY_WINDOW_DAYS=7`
- `TARGET_COVER_DAYS=LT + SAFETY_BUFFER_DAYS`
- `REORDER_MULTIPLE=1` (or pack_size)
- `MIN_ORDER_QTY=0`
- `MAX_ORDER_QTY=500`
- `ALERT_CHANNEL=#shelf-out-watcher`
- `SCHEDULE=hourly 8:00–20:00 local`

---

## 8) Data Schemas (minimal)

**inventory_snapshot.csv**

```
sku_id,location_id,on_hand,last_updated
A123,SFO1,22,2025-08-18T10:00:00Z

```

**sales.csv**

```
sku_id,location_id,ts,units_sold
A123,SFO1,2025-08-11,5

```

**supply.json**

```json
{"sku_id":"A123","location_id":"SFO1","lead_time_days":3,"open_pos":[{"qty":30,"eta":"2025-08-21"}]}

```

**catalog.csv**

```
sku_id,substitution_group_id,pack_size,uom
A123,G17,6,ea

```

---

## 9) Step‑by‑step Walkthrough (with numbers)

**Given:**

- `on_hand = 22`
- Last 7 days sales: `[6,5,4,5,5,6,4]` → `velocity ≈ 5.0/day`
- `lead_time_days = 3`, `safety_buffer_days = 2` → **need_days = 5**
- `DOC = on_hand / velocity = 22 / 5 = 4.4 days`
- `ROP = velocity * need_days = 5 * 5 = 25`
- Open PO: `qty=30`, `eta in 3 days` (arrives ≈ on lead time)

**Risk score:**

- `cover_gap = max(0, 5 - 4.4) / 5 = 0.12`
- `risk = 12` → **below threshold (60)** → **No alert**.

**What if on_hand = 10?**

- `DOC = 10/5 = 2.0`, `cover_gap = (5-2)/5 = 0.6` → `risk=60` → **Alert**.
- **Suggested order**: `(ROP + target_cover_days*velocity) - (on_hand + incoming_within_LT)`
    - `target_cover_days = 5`, `ROP + target_cover_days*velocity = 25 + 25 = 50`
    - `incoming_within_LT = 30`
    - `order_qty = 50 - (10 + 30) = 10` (snap to pack/reorder multiple as needed)

**Slack card (condensed):**

- Title: `A123 @ SFO1 — OOS risk 60 (2.0 DOC < 5.0 need)`
- Body: `Order 10 (LT=3d, safety=2d, velocity=5/d). Incoming 30 in 3d.`
- Buttons: **Approve(10)** | **Snooze(24h)** | **Reject(reason)**

---

## 10) Failure Modes & Guardrails

- **Velocity ~ 0:** treat as no risk (unless on_hand=0 and demand known upcoming → special case).
- **Data latency:** if `inventory.last_updated` too old, **snooze with warning**.
- **PO double‑creation:** use **idempotency keys** (`sku_id+location_id+date+run_id`).
- **Spiky sales:** use robust statistics (trimmed mean or median over 7–14 days).
- **Confidence bands:** degrade risk if data freshness is poor.

---

## 11) Testing & Validation

**Unit tests**

- Velocity calculation with sparse days.
- Risk score thresholds & rounding.
- Order qty rounding to pack multiples.

**Integration tests**

- Fake MCP responses → end‑to‑end path (Fetch → Decide → Notify → Act → Journal).

**Backtest (optional)**

- Replay last 8 weeks.
- Measure: alerts raised vs actual OOS events; compute precision/recall.

---

## 12) Privacy, Security, and Ops

- Store **only** minimal facts needed in `journal.log` (hash SKU if needed).
- Secrets: MCP tokens, Slack webhook in vault.
- Observability: per‑run counters (#SKUs scanned, alerts raised), error logs, latency.
- Rate limits: batch requests to MCP endpoints (paginate).

---

## 13) Example Decision Policy (copy‑paste rules)

1. **Skip** if `on_hand is None` or `velocity is None`.
2. **Compute** `velocity = max(ε, mov_avg_7d)`.
3. **Compute** `DOC = on_hand / velocity`.
4. **Compute** `need_days = lead_time_days + safety_buffer_days`.
5. **Risk**:
    - If `DOC >= need_days`: `risk=0`.
    - Else: `risk = round(100 * (need_days - DOC)/need_days)`.
6. **Trigger** if `risk ≥ RISK_THRESHOLD`.
7. **Propose**:
    - `target_stock = ROP + target_cover_days * velocity`
    - `incoming = sum(open_pos arriving ≤ lead_time_days)`
    - `order_qty = ceil_to_multiple(target_stock - (on_hand + incoming), reorder_multiple)`
    - Clamp with min/max order qty.
8. **If order_qty ≤ 0**, try **substitution** (same group, on_hand > threshold).
9. **Send** alert with **why** (numbers) + buttons.
10. **On approve**, create PO draft; **on snooze**, suppress 24h; **on reject**, store reason.

---

## 14) Example Folder Layout (when you’re ready to code)

```
shelf-out-watcher/
  README.md
  config/
    policy.yaml
  src/
    graph.py           # LangGraph nodes & wiring
    state.py           # TypedDicts & validation
    rules.py           # velocity, DOC, risk, order qty
    mcp_clients.py     # thin wrappers: wms, pos, erp, slack, journal
    callbacks.py       # Slack interactivity -> resume graph
    app.py             # entrypoint (cron or webhook)
  tests/
    test_rules.py
    test_graph.py

```

---

## 15) Roadmap (after MVP)

- **Smarter signals:** weather, local events, web traffic (Demand Pulse bridge).
- **Store clustering:** share inventory between nearby stores for faster fixes.
- **ILP for truck constraints:** pick order qty to fill pallets/trucks.
- **Learning thresholds:** adapt `RISK_THRESHOLD` by category/vendor.

---

## 16) What each component does (quick reference)

- **FetchSignals (node):** reads inventory/sales/supply/catalog; normalizes.
- **FeatureEngineer (node):** computes velocity, DOC, ROP, risk, propose qty.
- **Decide (node):** picks best action (replenish/substitute/snooze); attaches rationale.
- **Notify (node):** formats Slack blocks; posts; registers callback route.
- **AwaitApproval (edge):** pauses until Slack action payload returns.
- **Act (node):** calls `erp.po.create_draft` or `wms.task.create`.
- **Journal (node):** writes durable log (inputs, outputs, decisions, latencies).
