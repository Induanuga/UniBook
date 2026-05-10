// src/pages/MyApprovalStatusPage.tsx
// Subsystem 4 — Shows the approval status for every booking a student submitted.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { approvalService } from '../services/approvalService';
import type { ApprovalRequest } from '../services/approvalService';

type Status = ApprovalRequest['status'];

const STATUS_CONFIG: Record<Status, { color: string; bg: string; label: string; icon: string; description: string }> = {
  AWAITING_FACULTY: {
    color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: '⏳',
    label: 'Under Faculty Review',
    description: 'Your booking is awaiting review by a faculty member.',
  },
  AWAITING_ADMIN: {
    color: '#818cf8', bg: 'rgba(129,140,248,0.1)', icon: '🔐',
    label: 'Escalated to Admin',
    description: 'No faculty response in 24h — escalated to an administrator.',
  },
  APPROVED: {
    color: '#4ade80', bg: 'rgba(74,222,128,0.1)', icon: '✅',
    label: 'Booking Approved',
    description: 'Your booking has been approved. See you there!',
  },
  REJECTED: {
    color: '#f87171', bg: 'rgba(248,113,113,0.1)', icon: '❌',
    label: 'Booking Rejected',
    description: 'Your booking was not approved. Check the reason below.',
  },
  ALTERNATIVE_SUGGESTED: {
    color: '#38bdf8', bg: 'rgba(56,189,248,0.1)', icon: '📅',
    label: 'Alternative Suggested',
    description: 'A different time slot has been suggested for your booking.',
  },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function dur(s: string, e: string) {
  const m = Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? m % 60 + 'm' : ''}`.trim() : `${m}m`;
}

function ApprovalTimeline({ approval }: { approval: ApprovalRequest }) {
  const steps = [
    { key: 'submitted', label: 'Submitted',      done: true,                             date: approval.createdAt },
    { key: 'faculty',   label: 'Faculty Review',  done: approval.status !== 'AWAITING_FACULTY', date: approval.escalatedAt || undefined },
    { key: 'admin',     label: 'Admin Review',    done: approval.currentLevel === 'ADMIN' && approval.status !== 'AWAITING_ADMIN', date: undefined },
    { key: 'decided',   label: approval.status === 'APPROVED' ? 'Approved' : approval.status === 'REJECTED' ? 'Rejected' : 'Decision',
      done: ['APPROVED', 'REJECTED', 'ALTERNATIVE_SUGGESTED'].includes(approval.status), date: approval.decidedAt || undefined },
  ];

  return (
    <div className="approval-timeline">
      {steps.map((step, i) => (
        <div key={step.key} className={`timeline-step ${step.done ? 'done' : i === steps.findIndex(s => !s.done) ? 'current' : 'pending'}`}>
          <div className="timeline-dot" />
          {i < steps.length - 1 && <div className="timeline-line" />}
          <div className="timeline-info">
            <span className="timeline-label">{step.label}</span>
            {step.date && <span className="timeline-date">{fmt(step.date)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

interface Props {
  onBack: () => void;
}

export function MyApprovalStatusPage({ onBack }: Props) {
  const { accessToken } = useAuth();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const { approvals } = await approvalService.getMyApprovals(accessToken);
      setApprovals(approvals);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load approval status');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const sortedApprovals = [...approvals].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="booking-page">
      {/* Header */}
      <div className="booking-page-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div>
          <h1 className="booking-page-title">🔍 My Approval Status</h1>
          <p className="booking-page-sub">Track the approval progress of your submitted bookings</p>
        </div>
        <button className="refresh-btn" onClick={load} disabled={loading}>
          {loading ? <span className="btn-spinner small" /> : '↻ Refresh'}
        </button>
      </div>

      {/* Summary pills */}
      {!loading && approvals.length > 0 && (
        <div className="filter-bar" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          {(Object.entries(STATUS_CONFIG) as [Status, typeof STATUS_CONFIG[Status]][]).map(([status, cfg]) => {
            const count = approvals.filter(a => a.status === status).length;
            if (count === 0) return null;
            return (
              <div key={status} className="stat-chip status-chip" style={{ borderColor: cfg.color }}>
                <span style={{ color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                <span className="stat-num" style={{ color: cfg.color, marginLeft: 6 }}>{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="booking-loading"><div className="ub-spinner" /><p>Loading…</p></div>
      ) : error ? (
        <div className="booking-error">
          <p>⚠ {error}</p>
          <button className="retry-btn" onClick={load}>Retry</button>
        </div>
      ) : approvals.length === 0 ? (
        <div className="booking-empty">
          <div className="empty-icon">📭</div>
          <h3>No approval records yet</h3>
          <p>Once you submit a booking that requires approval, its status will appear here.</p>
        </div>
      ) : (
        <div className="booking-list">
          {sortedApprovals.map(a => {
            const cfg = STATUS_CONFIG[a.status];
            const isOpen = expanded === a.id;
            return (
              <div key={a.id} className="booking-card approval-status-card" style={{ borderLeft: `3px solid ${cfg.color}` }}>
                {/* Header row */}
                <button
                  id={`approval-expand-${a.id.slice(0,8)}`}
                  className="approval-card-header-btn"
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  aria-expanded={isOpen}
                >
                  <div className="booking-card-top" style={{ width: '100%' }}>
                    <div className="booking-resource">
                      <span className="resource-icon">🏢</span>
                      <div>
                        <div className="resource-name">{a.resourceName || a.resourceId}</div>
                        <div className="resource-id mono">{fmt(a.startTime)} ({dur(a.startTime, a.endTime)})</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span className="booking-status-badge" style={{ color: cfg.color, background: cfg.bg }}>
                        {cfg.icon} {cfg.label}
                      </span>
                      <span style={{ opacity: 0.5, fontSize: '1rem' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </div>
                </button>

                {/* Status message */}
                <p className="approval-status-message" style={{ color: cfg.color }}>
                  {cfg.description}
                </p>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="approval-detail-panel">
                    <ApprovalTimeline approval={a} />

                    <div className="approval-detail-grid">
                      <div className="detail-cell">
                        <span className="time-label">Purpose</span>
                        <span className="time-value">{a.purpose}</span>
                      </div>
                      <div className="detail-cell">
                        <span className="time-label">Submitted</span>
                        <span className="time-value">{fmt(a.createdAt)}</span>
                      </div>
                      {a.decidedByEmail && (
                        <div className="detail-cell">
                          <span className="time-label">Decided by</span>
                          <span className="time-value">{a.decidedByEmail}</span>
                        </div>
                      )}
                      {a.decidedAt && (
                        <div className="detail-cell">
                          <span className="time-label">Decision at</span>
                          <span className="time-value">{fmt(a.decidedAt)}</span>
                        </div>
                      )}
                    </div>

                    {/* Rejection reason */}
                    {a.decisionReason && (
                      <div className="decision-reason-box" style={{ borderColor: cfg.color }}>
                        <span className="time-label" style={{ display: 'block', marginBottom: '0.25rem' }}>
                          {a.status === 'APPROVED' ? 'Approver Note' : a.status === 'ALTERNATIVE_SUGGESTED' ? 'Suggestion Note' : 'Rejection Reason'}
                        </span>
                        <p className="purpose-text" style={{ margin: 0 }}>{a.decisionReason}</p>
                      </div>
                    )}

                    {/* Alternative slot */}
                    {a.status === 'ALTERNATIVE_SUGGESTED' && a.alternativeSlot && (
                      <div className="decision-reason-box" style={{ borderColor: '#38bdf8' }}>
                        <span className="time-label" style={{ display: 'block', marginBottom: '0.25rem' }}>
                          📅 Suggested Alternative Slot
                        </span>
                        <p className="purpose-text" style={{ margin: 0 }}>
                          {fmt(a.alternativeSlot.startTime)} → {fmt(a.alternativeSlot.endTime)} ({dur(a.alternativeSlot.startTime, a.alternativeSlot.endTime)})
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
