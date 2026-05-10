// src/pages/AnalyticsDashboardPage.tsx
// Subsystem 6 — Analytics & Reporting (Admin only)
//
// Features:
//   - Summary cards: total approved / cancelled / submitted / rejected
//   - Utilisation heatmap (hour × day-of-week grid)
//   - CSV export with date range + optional filters

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { analyticsService, type HeatmapCell, type AnalyticsSummary } from '../services/analyticsService';

interface Props {
  onBack: () => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) =>
  i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i - 12}pm`,
);

const ANALYTICS_DEPARTMENTS = [
  'CSE', 'CSD', 'ECE', 'ECD', 'CLD', 'CND', 'CSAM', 'Civil', 'Mtech', 'PhD', 'Others',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(s: string): boolean { return UUID_RE.test(s); }

// Local timezone offset in hours (e.g. IST = +5.5)
const LOCAL_OFFSET_HOURS = -new Date().getTimezoneOffset() / 60;

/**
 * Convert a UTC hour (0-23) + UTC day-of-week to local hour + local day-of-week.
 * Handles day rollover (e.g. UTC 23:00 → IST 04:30 next day).
 */
function utcToLocal(utcHour: number, utcDow: number): { hour: number; dow: number } {
  // Use integer hour offset (IST is +5.5 but we work in whole hours for the grid)
  const offsetH = Math.round(LOCAL_OFFSET_HOURS);
  let localHour = utcHour + offsetH;
  let localDow  = utcDow;
  if (localHour >= 24) { localHour -= 24; localDow = (localDow + 1) % 7; }
  if (localHour < 0)   { localHour += 24; localDow = (localDow + 6) % 7; }
  return { hour: localHour, dow: localDow };
}

// Build a 24×7 grid from flat cells array, converting UTC→local
function buildGrid(cells: HeatmapCell[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const cell of cells) {
    const { hour, dow } = utcToLocal(cell.hour, cell.dayOfWeek);
    if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) {
      grid[dow][hour] += cell.count;
    }
  }
  return grid;
}

function heatColor(count: number, max: number): string {
  if (count === 0) return 'rgba(99,102,241,0.06)';
  if (max === 0) return 'rgba(99,102,241,0.06)';
  const intensity = Math.min(count / max, 1);
  // low → high: light indigo → deep violet
  const alpha = 0.25 + intensity * 0.75;
  const r = Math.round(99  + (167 - 99)  * intensity);
  const g = Math.round(102 + (139 - 102) * intensity);
  const b = Math.round(241 + (250 - 241) * intensity);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Default date range: last 30 days to 30 days ahead (covers future bookings)
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultRange() {
  const to   = new Date();
  to.setDate(to.getDate() + 30);  // 30 days ahead to include future bookings
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: localDateStr(from),
    to:   localDateStr(to),
  };
}

export function AnalyticsDashboardPage({ onBack }: Props) {
  const { user, accessToken } = useAuth();

  const [from,       setFrom]       = useState(defaultRange().from);
  const [to,         setTo]         = useState(defaultRange().to);
  const [department, setDepartment] = useState('');
  const [resourceId, setResourceId] = useState('');

  const [summary,     setSummary]     = useState<AnalyticsSummary | null>(null);
  const [cells,       setCells]       = useState<HeatmapCell[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    // Don't filter by resourceId if it's not a valid UUID
    const validResourceId = resourceId && isValidUUID(resourceId) ? resourceId : undefined;
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, heatmapRes] = await Promise.all([
        analyticsService.getSummary({ from, to, department: department || undefined, resourceId: validResourceId }, accessToken),
        analyticsService.getHeatmap({ from, to, department: department || undefined, resourceId: validResourceId }, accessToken),
      ]);
      setSummary(summaryRes);
      setCells(heatmapRes.cells);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message || 'Failed to load analytics data.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, from, to, department, resourceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30 seconds so new bookings appear without manual Apply
  useEffect(() => {
    const interval = setInterval(() => { fetchData(); }, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleExport = async () => {
    if (!accessToken) return;
    const validResourceId = resourceId && isValidUUID(resourceId) ? resourceId : undefined;
    setExporting(true);
    try {
      const csv = await analyticsService.exportCsv(
        { from, to, department: department || undefined, resourceId: validResourceId },
        accessToken,
      );
      // Trigger browser download
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `unibook-analytics-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  if (!user || user.role !== 'ADMIN') {
    return (
      <div className="page-root">
        <div className="page-header">
          <button className="back-btn" onClick={onBack}>← Back</button>
          <h1 className="page-title">Analytics & Reporting</h1>
        </div>
        <div className="empty-state">
          <p>🔒 Admin access required.</p>
        </div>
      </div>
    );
  }

  const grid = buildGrid(cells);
  const max  = cells.reduce((m, c) => Math.max(m, c.count), 0);

  return (
    <div className="page-root">
      {/* ── Header ── */}
      <div className="page-header">
        <button className="back-btn" onClick={onBack}>← Dashboard</button>
        <h1 className="page-title">📊 Analytics & Reporting</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastUpdated && (
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            style={{ ...primaryBtnStyle, padding: '5px 12px', fontSize: '0.8rem' }}
            title="Refresh now"
          >
            {loading ? '⏳' : '↻ Refresh'}
          </button>
          <span style={{
            padding: '4px 12px', borderRadius: 99, fontSize: '0.8rem',
            background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
          }}>
            Admin Only · Subsystem 6
          </span>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="subsystem-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="section-title">Filters</h2>
          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
            📅 Date range filters by the booking's <strong style={{ color: '#9ca3af' }}>slot date</strong> (when the resource is booked for)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: '#9ca3af' }}>
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: '#9ca3af' }}>
            To
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: '#9ca3af' }}>
            Department (optional)
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">— All departments —</option>
              {ANALYTICS_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: '#9ca3af' }}>
            Resource ID (optional)
            <input
              type="text"
              placeholder="Full UUID e.g. a0000000-…"
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value.trim())}
              style={{ ...inputStyle, width: 260 }}
            />
            {resourceId && !isValidUUID(resourceId) && (
              <span style={{ color: '#f87171', fontSize: '0.75rem', marginTop: 2 }}>
                ⚠ Enter a full UUID (e.g. a0000000-0000-0000-0000-000000000003)
              </span>
            )}
          </label>
          <button
            onClick={fetchData}
            disabled={loading}
            style={primaryBtnStyle}
          >
            {loading ? '⏳ Loading…' : '🔄 Apply'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            style={secondaryBtnStyle}
          >
            {exporting ? '⏳ Exporting…' : '⬇ Export CSV'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: 10, padding: '12px 16px', color: '#f87171', marginBottom: 20,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Summary Cards ── */}
      {summary && (
        <div className="info-grid" style={{ marginBottom: 20 }}>
          <div className="info-card highlight">
            <div className="card-label">Approved</div>
            <div className="card-value success" style={{ fontSize: '2rem', fontWeight: 700 }}>
              {summary.totalApproved}
            </div>
            <p className="card-desc">Bookings confirmed</p>
          </div>
          <div className="info-card">
            <div className="card-label">Cancelled</div>
            <div className="card-value" style={{ fontSize: '2rem', fontWeight: 700, color: '#f59e0b' }}>
              {summary.totalCancelled}
            </div>
            <p className="card-desc">Cancelled by requester</p>
          </div>
          <div className="info-card">
            <div className="card-label">Rejected</div>
            <div className="card-value" style={{ fontSize: '2rem', fontWeight: 700, color: '#f87171' }}>
              {summary.totalRejected}
            </div>
            <p className="card-desc">Rejected by approver</p>
          </div>
          <div className="info-card">
            <div className="card-label">Alt. Suggested</div>
            <div className="card-value" style={{ fontSize: '2rem', fontWeight: 700, color: '#38bdf8' }}>
              {summary.totalAlternativeSuggested}
            </div>
            <p className="card-desc">Approver suggested another slot</p>
          </div>
          <div className="info-card">
            <div className="card-label">Pending</div>
            <div className="card-value" style={{ fontSize: '2rem', fontWeight: 700, color: '#818cf8' }}>
              {Math.max(0, summary.totalSubmitted - summary.totalApproved - summary.totalCancelled - summary.totalRejected - summary.totalAlternativeSuggested)}
            </div>
            <p className="card-desc">Awaiting decision · {summary.totalSubmitted} total submitted</p>
          </div>
        </div>
      )}

      {/* ── Heatmap ── */}
      <div className="subsystem-card">
        <div className="audit-header">
          <h2 className="section-title">Utilisation Heatmap</h2>
          <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
            {from} → {to} · approved bookings only · slot date · local time · darker = more bookings
          </span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div className="ub-spinner" />
          </div>
        ) : cells.length === 0 ? (
          <div className="empty-state">
            <p>No utilisation data for this range.</p>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 8 }}>
              Data appears here once bookings are approved. Rejected and cancelled bookings are not counted.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.75rem', minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={thStyle}></th>
                  {HOUR_LABELS.map((h, i) => (
                    <th key={i} style={{ ...thStyle, fontWeight: 400, color: '#6b7280', minWidth: 28 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAY_LABELS.map((day, d) => (
                  <tr key={d}>
                    <td style={{ ...thStyle, fontWeight: 600, color: '#9ca3af', paddingRight: 10, whiteSpace: 'nowrap' }}>
                      {day}
                    </td>
                    {grid[d].map((count, h) => (
                      <td
                        key={h}
                        title={`${day} ${HOUR_LABELS[h]} (local time): ${count} booking${count !== 1 ? 's' : ''}`}
                        style={{
                          width: 28, height: 22,
                          background: heatColor(count, max),
                          border: '1px solid rgba(255,255,255,0.04)',
                          borderRadius: 3,
                          textAlign: 'center',
                          color: count > 0 ? '#e5e7eb' : 'transparent',
                          fontSize: '0.65rem',
                          cursor: count > 0 ? 'default' : 'default',
                        }}
                      >
                        {count > 0 ? count : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: '0.75rem', color: '#6b7280' }}>
              <span>Low</span>
              {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v, i) => (
                <div key={i} style={{
                  width: 20, height: 14, borderRadius: 3,
                  background: heatColor(v * max, max),
                  border: '1px solid rgba(255,255,255,0.06)',
                }} />
              ))}
              <span>High ({max})</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: '7px 12px',
  color: '#e5e7eb',
  fontSize: '0.9rem',
  outline: 'none',
  minWidth: 140,
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'rgba(99,102,241,0.2)',
  border: '1px solid rgba(99,102,241,0.4)',
  borderRadius: 8,
  padding: '8px 18px',
  color: '#818cf8',
  fontSize: '0.9rem',
  cursor: 'pointer',
  fontWeight: 600,
};

const secondaryBtnStyle: React.CSSProperties = {
  background: 'rgba(245,158,11,0.12)',
  border: '1px solid rgba(245,158,11,0.3)',
  borderRadius: 8,
  padding: '8px 18px',
  color: '#f59e0b',
  fontSize: '0.9rem',
  cursor: 'pointer',
  fontWeight: 600,
};

const thStyle: React.CSSProperties = {
  padding: '2px 4px',
  textAlign: 'center',
  color: '#9ca3af',
  fontWeight: 500,
};
