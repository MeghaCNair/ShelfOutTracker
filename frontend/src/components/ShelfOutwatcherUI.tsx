import React, { useMemo, useState, useEffect } from "react";

// ---------- Types ----------
type InvRow = { sku_id: string; location_id: string; on_hand: number; last_updated: string };
type SaleSeries = number[];
type OpenPO = { qty: number; eta: string | null };
type Supply = { lead_time_days: number; open_pos: OpenPO[] };

type DemoData = {
  inventory: InvRow[];
  salesByKey: Record<string, SaleSeries>;
  supplyByKey: Record<string, Supply>;
  catalogBySku: Record<string, { sku_id: string; substitution_group_id: string; pack_size: number; uom: string }>;
};

// ---------- Demo data ----------
const DEMO: DemoData = {
  inventory: [
    { sku_id: "A123", location_id: "SFO1", on_hand: 22, last_updated: "2025-08-18T10:00:00Z" },
    { sku_id: "A124", location_id: "SFO1", on_hand: 10, last_updated: "2025-08-18T10:00:00Z" },
  ],
  salesByKey: {
    "A123|SFO1": [6, 5, 4, 5, 5, 6, 4],
    "A124|SFO1": [3, 2, 1, 2, 2, 0, 0],
  },
  supplyByKey: {
    "A123|SFO1": { lead_time_days: 3, open_pos: [{ qty: 30, eta: "2025-08-21" }] },
    "A124|SFO1": { lead_time_days: 4, open_pos: [{ qty: 0, eta: null }] },
  },
  catalogBySku: {
    A123: { sku_id: "A123", substitution_group_id: "G17", pack_size: 6, uom: "ea" },
    A124: { sku_id: "A124", substitution_group_id: "G17", pack_size: 6, uom: "ea" },
  },
};

// ---------- Rules (match Python) ----------
const EPS = 1e-9;

function movingAverage(xs: number[], window: number): number {
  if (!xs || xs.length === 0) return 0;
  const slice = xs.slice(Math.max(0, xs.length - window));
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
}
function ceilToMultiple(x: number, multiple: number): number {
  if (multiple <= 1) return Math.ceil(Math.max(0, x));
  return Math.ceil(Math.max(0, x) / multiple) * multiple;
}
function computeFeatures(args: {
  on_hand: number;
  sales: number[];
  lt: number;
  safetyBuffer: number;
  window: number;
  openPos: OpenPO[];
}) {
  const { on_hand, sales, lt, safetyBuffer, window, openPos } = args;
  const velocity = movingAverage(sales, window);
  const effVel = Math.max(velocity, EPS);
  const doc = on_hand / effVel;
  const needDays = lt + safetyBuffer;
  const rop = effVel * needDays;
  const incomingWithinLT = (openPos || []).reduce((s, p) => s + (p.qty || 0), 0);
  const coverGap = Math.max(0, needDays - doc) / Math.max(needDays, EPS);
  const risk = effVel <= EPS ? 0 : Math.round(100 * Math.min(1, coverGap));
  return { velocity, effVel, doc, needDays, rop, incomingWithinLT, risk };
}
function proposeQty(args: {
  on_hand: number;
  feats: ReturnType<typeof computeFeatures>;
  reorderMultiple: number;
  minQty: number;
  maxQty: number;
}) {
  const { on_hand, feats, reorderMultiple, minQty, maxQty } = args;
  const targetStock = feats.rop + feats.needDays * Math.max(feats.velocity, EPS);
  const raw = targetStock - (on_hand + feats.incomingWithinLT);
  let qty = ceilToMultiple(raw, reorderMultiple);
  qty = Math.max(minQty, Math.min(qty, maxQty));
  return Math.max(0, qty);
}

// ---------- Enhanced UI Components ----------
function Section({ title, children, className = "", icon }: { title: string; children: React.ReactNode; className?: string; icon?: string }) {
  return (
    <div className={`fallback-card ${className}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        {icon && <span style={{ fontSize: '24px' }}>{icon}</span>}
        <h2 style={{ fontWeight: 'bold', fontSize: '20px', color: 'white', margin: 0 }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function ProgressBar({ value, className = "", showLabel = true }: { value: number; className?: string; showLabel?: boolean }) {
  const getColor = (val: number) => {
    if (val < 30) return "#10b981";
    if (val < 60) return "#f59e0b";
    return "#ef4444";
  };
  
  return (
    <div style={{ marginBottom: '16px' }}>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px' }}>
          <span style={{ color: '#d1d5db' }}>Risk Level</span>
          <span style={{ fontWeight: 'bold', color: getColor(value) }}>{value}%</span>
        </div>
      )}
      <div style={{ 
        width: '100%', 
        height: '12px', 
        backgroundColor: 'rgba(55, 65, 81, 0.5)', 
        borderRadius: '9999px', 
        overflow: 'hidden' 
      }}>
        <div 
          style={{ 
            height: '100%', 
            backgroundColor: getColor(value),
            width: `${Math.max(0, Math.min(100, value))}%`,
            transition: 'width 1s ease-out'
          }} 
        />
      </div>
    </div>
  );
}

function FlowStep({ title, icon, active, completed, step }: { title: string; icon: string; active?: boolean; completed?: boolean; step: number }) {
  const getBgColor = () => {
    if (completed) return 'rgba(34, 197, 94, 0.2)';
    if (active) return 'rgba(59, 130, 246, 0.2)';
    return 'rgba(55, 65, 81, 0.5)';
  };
  
  const getBorderColor = () => {
    if (completed) return 'rgba(34, 197, 94, 0.5)';
    if (active) return 'rgba(59, 130, 246, 0.5)';
    return 'rgba(75, 85, 99, 0.5)';
  };
  
  const getIconColor = () => {
    if (completed) return '#4ade80';
    if (active) return '#60a5fa';
    return '#6b7280';
  };
  
  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px',
      borderRadius: '16px',
      backgroundColor: getBgColor(),
      border: `1px solid ${getBorderColor()}`,
      backdropFilter: 'blur(8px)',
      transition: 'all 0.5s ease'
    }}>
      <div style={{
        position: 'absolute',
        top: '-12px',
        left: '-12px',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: '#1f2937',
        border: '2px solid #374151',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: 'bold',
        color: '#9ca3af'
      }}>
        {step}
      </div>
      <div style={{ 
        fontSize: '32px', 
        marginBottom: '12px',
        color: getIconColor(),
        transform: active || completed ? 'scale(1.1)' : 'scale(1)',
        transition: 'all 0.3s ease'
      }}>
        {icon}
      </div>
      <div style={{ 
        fontSize: '14px', 
        fontWeight: '500', 
        textAlign: 'center',
        color: active || completed ? '#e5e7eb' : '#9ca3af',
        transition: 'all 0.3s ease'
      }}>
        {title}
      </div>
    </div>
  );
}

function SalesChart({ sales }: { sales: number[] }) {
  const max = Math.max(...sales, 1);
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'end', 
        gap: '4px', 
        height: '64px',
        marginBottom: '12px'
      }}>
        {sales.map((sale, i) => (
          <div
            key={i}
            style={{
              background: 'linear-gradient(to top, #3b82f6, #1d4ed8)',
              borderRadius: '8px 8px 0 0',
              height: `${(sale / max) * 100}%`,
              minHeight: '8px',
              width: '12px',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            title={`Day ${i + 1}: ${sale} units`}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(to top, #60a5fa, #3b82f6)';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(to top, #3b82f6, #1d4ed8)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center' }}>7-day sales trend</div>
    </div>
  );
}

function AnimatedCounter({ value, suffix = "", className = "" }: { value: number; suffix?: string; className?: string }) {
  const [displayValue, setDisplayValue] = useState(0);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDisplayValue(value);
    }, 100);
    return () => clearTimeout(timer);
  }, [value]);
  
  return (
    <span style={{ fontWeight: 'bold' }}>
      {displayValue.toFixed(displayValue % 1 === 0 ? 0 : 2)}{suffix}
    </span>
  );
}

function Metric({ label, value, icon, trend, className = "" }: { 
  label: string; 
  value: string | number; 
  icon?: string; 
  trend?: 'up' | 'down' | 'stable';
  className?: string;
}) {
  const getTrendColor = () => {
    if (trend === 'up') return '#4ade80';
    if (trend === 'down') return '#f87171';
    return '#9ca3af';
  };
  
  const getTrendIcon = () => {
    if (trend === 'up') return '↗️';
    if (trend === 'down') return '↘️';
    return '→';
  };
  
  return (
    <div style={{
      padding: '16px',
      borderRadius: '16px',
      background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.5), rgba(17, 24, 39, 0.5))',
      border: '1px solid rgba(55, 65, 81, 0.5)',
      backdropFilter: 'blur(8px)',
      transition: 'all 0.3s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {icon} {label}
        </div>
        {trend && (
          <span style={{ fontSize: '12px', color: getTrendColor() }}>
            {getTrendIcon()}
          </span>
        )}
      </div>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'white' }}>{value}</div>
    </div>
  );
}

// ---------- Main component ----------
export default function ShelfOutWatcherUI() {
  const [riskThreshold, setRiskThreshold] = useState<number>(60);
  const [safetyBufferDays, setSafetyBufferDays] = useState<number>(2);
  const [velocityWindow, setVelocityWindow] = useState<number>(7);
  const [reorderMultiple, setReorderMultiple] = useState<number>(1);
  const [minOrderQty, setMinOrderQty] = useState<number>(0);
  const [maxOrderQty, setMaxOrderQty] = useState<number>(500);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(true);

  const rows = useMemo(() => {
    return DEMO.inventory.map((inv) => {
      const key = `${inv.sku_id}|${inv.location_id}`;
      const sales = DEMO.salesByKey[key] ?? [];
      const supply = DEMO.supplyByKey[key] ?? { lead_time_days: 0, open_pos: [] };
      const feats = computeFeatures({
        on_hand: inv.on_hand,
        sales,
        lt: supply.lead_time_days,
        safetyBuffer: safetyBufferDays,
        window: velocityWindow,
        openPos: supply.open_pos,
      });
      const decision = feats.risk >= riskThreshold ? "replenish" : "noop";
      const orderQty =
        decision === "replenish"
          ? proposeQty({ on_hand: inv.on_hand, feats, reorderMultiple, minQty: minOrderQty, maxQty: maxOrderQty })
          : 0;
      return { ...inv, sales, supply, feats, decision, orderQty };
    });
  }, [riskThreshold, safetyBufferDays, velocityWindow, reorderMultiple, minOrderQty, maxOrderQty]);

  const riskyCount = rows.filter(r => r.decision === "replenish").length;
  const totalValue = rows.reduce((sum, r) => sum + r.on_hand, 0);

  return (
    <div className="fallback-container">
      {/* Test section to verify CSS is working */}
      <div style={{ 
        background: 'linear-gradient(135deg, #0ea5e9 0%, #0891b2 100%)', 
        padding: '16px', 
        borderRadius: '12px', 
        marginBottom: '24px',
        textAlign: 'center',
        boxShadow: '0 10px 25px -5px rgba(14, 165, 233, 0.3)'
      }}>
        <h3 style={{ color: '#ffffff', fontWeight: 'bold', margin: 0, fontSize: '16px' }}>✨ Modern UI Active - Enhanced Inventory Management System</h3>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 16px' }}>
        {/* Enhanced Header */}
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ 
              fontSize: '48px', 
              fontWeight: 'bold', 
              background: 'linear-gradient(45deg, #0ea5e9, #0891b2, #0d9488)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              margin: '0 0 16px 0'
            }}>
              🚀 Shelf‑Out Watcher
            </h1>
            <p style={{ fontSize: '20px', color: '#94a3b8', maxWidth: '600px', margin: '0 auto' }}>
              Intelligent inventory management with real-time risk assessment and predictive analytics
            </p>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{
              background: 'rgba(14, 165, 233, 0.1)',
              backdropFilter: 'blur(20px)',
              borderRadius: '9999px',
              padding: '12px 24px',
              border: '1px solid rgba(14, 165, 233, 0.3)',
              transition: 'all 0.3s ease'
            }}>
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#e0f2fe', display: 'flex', alignItems: 'center', gap: '8px' }}>
                📊 <AnimatedCounter value={rows.length} /> SKUs monitored
              </span>
            </div>
            <div style={{
              background: 'rgba(245, 158, 11, 0.1)',
              backdropFilter: 'blur(20px)',
              borderRadius: '9999px',
              padding: '12px 24px',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              transition: 'all 0.3s ease'
            }}>
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#fef3c7', display: 'flex', alignItems: 'center', gap: '8px' }}>
                ⚠️ <AnimatedCounter value={riskyCount} /> need attention
              </span>
            </div>
            <div style={{
              background: 'rgba(34, 197, 94, 0.1)',
              backdropFilter: 'blur(20px)',
              borderRadius: '9999px',
              padding: '12px 24px',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              transition: 'all 0.3s ease'
            }}>
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#dcfce7', display: 'flex', alignItems: 'center', gap: '8px' }}>
                💰 <AnimatedCounter value={totalValue} /> total units
              </span>
            </div>
          </div>
        </div>

        {/* Enhanced Flow Diagram */}
        <Section title="Processing Pipeline" icon="🔄">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px', alignItems: 'center' }}>
            <FlowStep title="Fetch Data" icon="📊" active step={1} />
            <div style={{ fontSize: '24px', color: '#64748b', textAlign: 'center' }}>→</div>
            <FlowStep title="Analyze" icon="🧮" active step={2} />
            <div style={{ fontSize: '24px', color: '#64748b', textAlign: 'center' }}>→</div>
            <FlowStep title="Decide" icon="🎯" active step={3} />
            <div style={{ fontSize: '24px', color: '#64748b', textAlign: 'center' }}>→</div>
            <FlowStep title="Act" icon="⚡" active step={4} />
          </div>
        </Section>

        {/* Enhanced Controls */}
        <Section title="Policy Configuration" icon="⚙️">
          <div style={{ display: 'grid', gap: '32px', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <label style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '12px', display: 'block' }}>
                  Risk Threshold: <span style={{ color: '#0ea5e9' }}>{riskThreshold}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={riskThreshold}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRiskThreshold(parseInt(e.target.value, 10))}
                  style={{
                    width: '100%',
                    height: '12px',
                    backgroundColor: '#334155',
                    borderRadius: '8px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '8px', display: 'block' }}>Safety Buffer (days)</label>
                <input
                  type="number"
                  value={safetyBufferDays}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSafetyBufferDays(parseFloat(e.target.value || "0"))}
                  style={{
                    width: '100%',
                    backgroundColor: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    color: 'white',
                    outline: 'none'
                  }}
                />
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <label style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '8px', display: 'block' }}>Velocity Window (days)</label>
                <input
                  type="number"
                  value={velocityWindow}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVelocityWindow(parseInt(e.target.value || "7", 10))}
                  style={{
                    width: '100%',
                    backgroundColor: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    color: 'white',
                    outline: 'none'
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '8px', display: 'block' }}>Reorder Multiple</label>
                <input
                  type="number"
                  value={reorderMultiple}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReorderMultiple(parseInt(e.target.value || "1", 10))}
                  style={{
                    width: '100%',
                    backgroundColor: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    color: 'white',
                    outline: 'none'
                  }}
                />
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '8px', display: 'block' }}>Min Qty</label>
                  <input
                    type="number"
                    value={minOrderQty}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinOrderQty(parseInt(e.target.value || "0", 10))}
                    style={{
                      width: '100%',
                      backgroundColor: 'rgba(30, 41, 59, 0.5)',
                      border: '1px solid #475569',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      color: 'white',
                      outline: 'none'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '8px', display: 'block' }}>Max Qty</label>
                  <input
                    type="number"
                    value={maxOrderQty}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxOrderQty(parseInt(e.target.value || "500", 10))}
                    style={{
                      width: '100%',
                      backgroundColor: 'rgba(30, 41, 59, 0.5)',
                      border: '1px solid #475569',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      color: 'white',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Enhanced Results */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '32px' }}>
          {rows.map((r, index) => (
            <div 
              key={`${r.sku_id}|${r.location_id}`} 
              style={{
                background: 'rgba(14, 165, 233, 0.05)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(14, 165, 233, 0.2)',
                borderRadius: '24px',
                padding: '32px',
                transition: 'all 0.5s ease',
                cursor: 'pointer',
                transform: selectedSku === `${r.sku_id}|${r.location_id}` ? 'scale(1.02)' : 'scale(1)',
                boxShadow: selectedSku === `${r.sku_id}|${r.location_id}` ? '0 25px 50px -12px rgba(14, 165, 233, 0.25)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
              }}
              onClick={() => setSelectedSku(selectedSku === `${r.sku_id}|${r.location_id}` ? null : `${r.sku_id}|${r.location_id}`)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'white', marginBottom: '8px' }}>
                    📦 {r.sku_id} <span style={{ color: '#94a3b8' }}>@ {r.location_id}</span>
                  </div>
                  <div style={{ fontSize: '14px', color: '#cbd5e1' }}>
                    On‑hand: <span style={{ color: '#0ea5e9', fontWeight: 'bold' }}>{r.on_hand}</span> • LT: <span style={{ color: '#0891b2', fontWeight: 'bold' }}>{r.supply.lead_time_days}d</span>
                  </div>
                </div>
                <div>
                  {r.decision === "replenish" ? (
                    <span style={{
                      padding: '8px 16px',
                      fontSize: '14px',
                      borderRadius: '9999px',
                      background: 'linear-gradient(45deg, rgba(239, 68, 68, 0.2), rgba(245, 158, 11, 0.2))',
                      color: '#fca5a5',
                      border: '1px solid rgba(239, 68, 68, 0.5)',
                      animation: 'pulse 2s infinite'
                    }}>
                      ⚠️ Risk {r.feats.risk}%
                    </span>
                  ) : (
                    <span style={{
                      padding: '8px 16px',
                      fontSize: '14px',
                      borderRadius: '9999px',
                      background: 'linear-gradient(45deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.2))',
                      color: '#86efac',
                      border: '1px solid rgba(34, 197, 94, 0.5)'
                    }}>
                      ✅ Safe
                    </span>
                  )}
                </div>
              </div>

              {/* Sales Chart */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '12px' }}>📈 Sales Trend (7 days)</div>
                <SalesChart sales={r.sales} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <Metric label="Velocity" value={`${r.feats.velocity.toFixed(2)} u/d`} icon="📊" trend="up" />
                <Metric label="DOC" value={`${r.feats.doc.toFixed(2)} days`} icon="📅" trend="stable" />
                <Metric label="Need" value={`${r.feats.needDays.toFixed(1)} days`} icon="⏰" />
                <Metric label="ROP" value={`${r.feats.rop.toFixed(1)} u`} icon="🎯" />
                <Metric label="Incoming" value={`${r.feats.incomingWithinLT.toFixed(0)} u`} icon="🚚" />
                <div style={{ gridColumn: 'span 2' }}>
                  <ProgressBar value={r.feats.risk} />
                </div>
              </div>

              {r.decision === "replenish" && (
                <div style={{
                  padding: '24px',
                  background: 'linear-gradient(45deg, rgba(239, 68, 68, 0.1), rgba(245, 158, 11, 0.1))',
                  borderRadius: '16px',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  backdropFilter: 'blur(8px)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '14px' }}>
                      <span style={{ fontWeight: 'bold', color: '#fca5a5' }}>🚨 Action Required:</span>
                      <br />
                      Order <span style={{ fontWeight: 'bold', fontSize: '24px', color: '#f87171' }}>{r.orderQty}</span> units
                    </div>
                    <button style={{
                      padding: '12px 24px',
                      fontSize: '14px',
                      borderRadius: '9999px',
                      background: 'linear-gradient(45deg, #ef4444, #dc2626)',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                    }}>
                      📝 Create PO
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', color: '#64748b', padding: '32px 0' }}>
          <div style={{
            background: 'rgba(14, 165, 233, 0.1)',
            backdropFilter: 'blur(20px)',
            borderRadius: '9999px',
            padding: '16px 32px',
            display: 'inline-block',
            border: '1px solid rgba(14, 165, 233, 0.2)',
            transition: 'all 0.3s ease'
          }}>
            🔄 Real-time monitoring • 📊 Data-driven decisions • ⚡ Instant alerts • 🎯 Predictive analytics
          </div>
        </div>
      </div>


    </div>
  );
}
