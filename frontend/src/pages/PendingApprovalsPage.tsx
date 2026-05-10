// src/pages/PendingApprovalsPage.tsx
// Subsystem 4 — Approval dashboard for FACULTY and ADMIN users.
// Shows all approvals assigned to the current approver; allows APPROVE / REJECT / SUGGEST_ALTERNATIVE.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { approvalService } from '../services/approvalService';
import type { ApprovalRequest, DecisionPayload } from '../services/approvalService';

type ApprovalStatus = ApprovalRequest['status'];

const STATUS_STYLE: Record<ApprovalStatus, { color: string; bg: string; label: string; icon: string }> = {
  AWAITING_FACULTY:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: 'Awaiting Faculty',  icon: '⏳' },
  AWAITING_ADMIN:      { color: '#818cf8', bg: 'rgba(129,140,248,0.12)', label: 'Awaiting Admin',    icon: '🔐' },
  APPROVED:            { color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  label: 'Approved',          icon: '✅' },
  REJECTED:            { color: '#f87171', bg: 'rgba(248,113,113,0.12)', label: 'Rejected',          icon: '❌' },
  ALTERNATIVE_SUGGESTED: { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', label: 'Alt. Suggested', icon: '📅' },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function dur(s: string, e: string) {
  const m = Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? m % 60 + 'm' : ''}`.trim() : `${m}m`;
}

interface DecideModalProps {
  approval:  ApprovalRequest;
  onClose:   () => void;
  onDecided: (updated: ApprovalRequest) => void;
}

function DecideModal({ approval, onClose, onDecided }: DecideModalProps) {
  const { accessToken } = useAuth();
  const [decision, setDecision]   = useState<'APPROVE' | 'REJECT' | 'SUGGEST_ALTERNATIVE'>('APPROVE');
  const [reason, setReason]       = useState('');
  const [altStart, setAltStart]   = useState('');
  const [altEnd, setAltEnd]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const submit = async () => {
    if (!accessToken) return;
    if (decision === 'SUGGEST_ALTERNATIVE' && (!altStart || !altEnd)) {
      setError('Please provide both alternative start and end times.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: DecisionPayload = { decision, reason: reason || undefined };
      if (decision === 'SUGGEST_ALTERNATIVE') {
        payload.alternativeStart = new Date(altStart).toISOString();
        payload.alternativeEnd   = new Date(altEnd).toISOString();
      }
      const { approval: updated } = await approvalService.decide(approval.id, payload, accessToken);
      onDecided(updated);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to submit decision');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Record decision">
      <div className="modal-panel" style={{ maxWidth: 520 }}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">📋 Record Decision</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Approval summary */}
        <div className="approval-summary-box">
          <div className="summary-row">
            <span className="summary-label">Requester</span>
            <span className="summary-value">{approval.requesterName} <span className="mono" style={{ fontSize: '0.75rem', opacity: 0.6 }}>({approval.requesterRole})</span></span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Resource</span>
            <span className="summary-value">{approval.resourceName || approval.resourceId}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">When</span>
            <span className="summary-value">{fmt(approval.startTime)} → {fmt(approval.endTime)} <span className="summary-dur">({dur(approval.startTime, approval.endTime)})</span></span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Purpose</span>
            <span className="summary-value">{approval.purpose}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Dept.</span>
            <span className="summary-value">{approval.department || '—'}</span>
          </div>
        </div>

        {/* Decision buttons */}
        <div className="decision-type-row">
          {(['APPROVE', 'REJECT', 'SUGGEST_ALTERNATIVE'] as const).map(d => (
            <button
              key={d}
              id={`decide-btn-${d.toLowerCase()}`}
              className={`decision-type-btn ${decision === d ? 'selected' : ''} decision-${d.toLowerCase().replace('_', '-')}`}
              onClick={() => setDecision(d)}
            >
              {d === 'APPROVE' ? '✅ Approve' : d === 'REJECT' ? '❌ Reject' : '📅 Suggest Alternative'}
            </button>
          ))}
        </div>

        {/* Reason */}
        <label className="form-label">
          Reason{decision !== 'APPROVE' ? ' (required)' : ' (optional)'}
          <textarea
            id="decide-reason"
            className="form-textarea"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={
              decision === 'APPROVE'
                ? 'Any notes for the requester…'
                : decision === 'REJECT'
                ? 'Explain why this booking cannot be approved…'
                : 'Explain why you\'re suggesting an alternative slot…'
            }
          />
        </label>

        {/* Alternative slots */}
        {decision === 'SUGGEST_ALTERNATIVE' && (
          <div className="alt-slot-row">
            <label className="form-label" style={{ flex: 1 }}>
              Alternative Start
              <input
                id="decide-alt-start"
                type="datetime-local"
                className="form-input"
                value={altStart}
                onChange={e => setAltStart(e.target.value)}
              />
            </label>
            <label className="form-label" style={{ flex: 1 }}>
              Alternative End
              <input
                id="decide-alt-end"
                type="datetime-local"
                className="form-input"
                value={altEnd}
                onChange={e => setAltEnd(e.target.value)}
              />
            </label>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        {/* Actions */}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            id="decide-submit-btn"
            className={`btn-primary decision-submit-${decision.toLowerCase()}`}
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? <span className="btn-spinner small" /> : (
              decision === 'APPROVE' ? 'Approve Booking' :
              decision === 'REJECT' ? 'Reject Booking' :
              'Suggest This Slot'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  onBack: () => void;
}

export function PendingApprovalsPage({ onBack }: Props) {
  const { accessToken } = useAuth();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [deciding, setDeciding]   = useState<ApprovalRequest | null>(null);
  const [toast, setToast]         = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const { approvals } = await approvalService.getPendingApprovals(accessToken);
      setApprovals(approvals);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const onDecided = (updated: ApprovalRequest) => {
    setApprovals(prev => prev.filter(a => a.id !== updated.id));
    setDeciding(null);
    const action = updated.status === 'APPROVED' ? 'approved' :
      updated.status === 'REJECTED' ? 'rejected' : 'suggestion sent';
    setToast(`✅ Booking ${action} successfully.`);
    setTimeout(() => setToast(null), 4000);
  };

  const pending = approvals.filter(a =>
    a.status === 'AWAITING_FACULTY' || a.status === 'AWAITING_ADMIN'
  );

  return (
    <div className="booking-page">
      {/* Toast */}
      {toast && (
        <div className="toast-notification" role="status" aria-live="polite">{toast}</div>
      )}

      {/* Header */}
      <div className="booking-page-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div>
          <h1 className="booking-page-title">📋 Pending Approvals</h1>
          <p className="booking-page-sub">Review and decide on booking requests assigned to you</p>
        </div>
        <button className="refresh-btn" onClick={load} disabled={loading}>
          {loading ? <span className="btn-spinner small" /> : '↻ Refresh'}
        </button>
      </div>

      {/* Stats bar */}
      <div className="approval-stats-bar">
        <div className="stat-chip">
          <span className="stat-num" style={{ color: '#f59e0b' }}>{pending.length}</span>
          <span className="stat-label">Awaiting Action</span>
        </div>               
      </div>

      {/* Content */}
      {loading ? (
        <div className="booking-loading"><div className="ub-spinner" /><p>Loading approvals…</p></div>
      ) : error ? (
        <div className="booking-error">
          <p>⚠ {error}</p>
          <button className="retry-btn" onClick={load}>Retry</button>
        </div>
      ) : approvals.length === 0 ? (
        <div className="booking-empty">
          <div className="empty-icon">🎉</div>
          <h3>You're all caught up!</h3>
          <p>No pending approvals assigned to you at this time.</p>
        </div>
      ) : (
        <div className="booking-list">
          {approvals.map(a => {
            const st = STATUS_STYLE[a.status];
            const isPending = a.status === 'AWAITING_FACULTY' || a.status === 'AWAITING_ADMIN';
            return (
              <div key={a.id} className="booking-card approval-card">
                {/* Top: requester + status */}
                <div className="booking-card-top">
                  <div className="booking-resource">
                    <span className="resource-icon">👤</span>
                    <div>
                      <div className="resource-name">{a.requesterName}</div>
                      <div className="resource-id mono">{a.requesterEmail} · {a.requesterRole}</div>
                    </div>
                  </div>
                  <span className="booking-status-badge" style={{ color: st.color, background: st.bg }}>
                    {st.icon} {st.label}
                  </span>
                </div>

                {/* Resource */}
                <div className="approval-resource-row">
                  <span className="resource-icon" style={{ fontSize: '0.9rem' }}>🏢</span>
                  <span style={{ fontWeight: 600 }}>{a.resourceName || a.resourceId}</span>
                  {a.department && (
                    <span className="approval-dept-chip">{a.department}</span>
                  )}
                </div>

                {/* Times */}
                <div className="booking-times">
                  <div className="time-row">
                    <span className="time-label">From</span>
                    <span className="time-value">{fmt(a.startTime)}</span>
                  </div>
                  <div className="time-row">
                    <span className="time-label">To</span>
                    <span className="time-value">{fmt(a.endTime)}</span>
                  </div>
                  <div className="time-row">
                    <span className="time-label">Duration</span>
                    <span className="time-value">{dur(a.startTime, a.endTime)}</span>
                  </div>
                </div>

                {/* Purpose */}
                <div className="booking-purpose">
                  <span className="purpose-label">Purpose</span>
                  <p className="purpose-text">{a.purpose}</p>
                </div>

                {/* Footer */}
                <div className="booking-card-footer">
                  <div className="booking-meta">
                    <span className="mono" style={{ fontSize: '0.7rem', opacity: 0.5 }}>
                      #{a.id.slice(0, 8)}
                    </span>
                    <span className="dot">·</span>
                    <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>
                      Submitted {new Date(a.createdAt).toLocaleDateString()}
                    </span>
                    {a.currentLevel && (
                      <>
                        <span className="dot">·</span>
                        <span style={{ opacity: 0.7, fontSize: '0.75rem' }}>
                          Level: {a.currentLevel}
                        </span>
                      </>
                    )}
                  </div>
                  {isPending && (
                    <button
                      id={`decide-btn-${a.id.slice(0,8)}`}
                      className="new-booking-btn"
                      style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                      onClick={() => setDeciding(a)}
                    >
                      Decide →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Decision modal */}
      {deciding && (
        <DecideModal
          approval={deciding}
          onClose={() => setDeciding(null)}
          onDecided={onDecided}
        />
      )}
    </div>
  );
}
