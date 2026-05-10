// src/pages/MyBookingsPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { bookingService } from '../services/bookingService';
import { approvalService } from '../services/approvalService';
import type { Booking, BookingStatus } from '../services/bookingService';
import type { ApprovalRequest } from '../services/approvalService';

const STATUS_STYLE: Record<BookingStatus | 'ALTERNATIVE_SUGGESTED', { color: string; bg: string; label: string }> = {
  PENDING:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: '⏳ Pending' },
  APPROVED:  { color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  label: '✅ Approved' },
  REJECTED:  { color: '#f87171', bg: 'rgba(248,113,113,0.12)', label: '❌ Rejected' },
  CANCELLED: { color: '#6b7280', bg: 'rgba(107,114,128,0.12)', label: '🚫 Cancelled' },
  ALTERNATIVE_SUGGESTED: { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', label: '📅 Alternative Suggested' },
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

function duration(start: string, end: string) {
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60 ? (mins % 60) + 'm' : ''}`.trim() : `${mins}m`;
}

interface Props {
  onBack:      () => void;
  onNewBooking: () => void;
}

export function MyBookingsPage({ onBack, onNewBooking }: Props) {
  const { accessToken } = useAuth();
  const [bookings, setBookings]   = useState<Booking[]>([]);
  const [approvals, setApprovals] = useState<Record<string, ApprovalRequest | null>>({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [filter, setFilter]       = useState<BookingStatus | 'ALL'>('ALL');

  // Fetch approval status for a booking
  const fetchApprovalForBooking = useCallback(async (bookingId: string) => {
    if (!accessToken) return;
    try {
      const { approval } = await approvalService.getApprovalForBooking(bookingId, accessToken);
      setApprovals(prev => ({ ...prev, [bookingId]: approval }));
    } catch {
      // Approval not found or error — it's okay, booking might not need approval
      setApprovals(prev => ({ ...prev, [bookingId]: null }));
    }
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const { bookings } = await bookingService.getMyBookings(accessToken);
      setBookings(bookings);

      // Fetch approval status for each booking
      await Promise.all(bookings.map(b => fetchApprovalForBooking(b.id)));
    } catch (e: any) {
      setError(e.message || 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [accessToken, fetchApprovalForBooking]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id: string) => {
    if (!accessToken) return;
    if (!confirm('Cancel this booking?')) return;
    setCancelling(id);
    try {
      const { booking: updated } = await bookingService.cancelBooking(id, accessToken);
      setBookings(prev => prev.map(b => b.id === id ? updated : b));
    } catch (e: any) {
      alert(e.message || 'Could not cancel booking');
    } finally {
      setCancelling(null);
    }
  };

  const visible = filter === 'ALL' ? bookings : bookings.filter(b => b.status === filter);
  const counts  = bookings.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Get display status: override PENDING with ALTERNATIVE_SUGGESTED if applicable
  const getDisplayStatus = (booking: Booking): BookingStatus | 'ALTERNATIVE_SUGGESTED' => {
    if (booking.status === 'PENDING') {
      const approval = approvals[booking.id];
      if (approval?.status === 'ALTERNATIVE_SUGGESTED') {
        return 'ALTERNATIVE_SUGGESTED';
      }
    }
    return booking.status;
  };

  return (
    <div className="booking-page">
      {/* Header */}
      <div className="booking-page-header">
        <button className="back-btn" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1 className="booking-page-title">📅 My Bookings</h1>
          <p className="booking-page-sub">View and manage all your resource reservations</p>
        </div>
        <button className="new-booking-btn" onClick={onNewBooking}>
          ＋ New Booking
        </button>
      </div>

      {/* Filter pills */}
      <div className="filter-bar">
        {(['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map(s => (
          <button
            key={s}
            className={`filter-pill ${filter === s ? 'active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s === 'ALL' ? `All (${bookings.length})` : `${STATUS_STYLE[s].label} (${counts[s] || 0})`}
          </button>
        ))}
        <button className="refresh-btn" onClick={load} disabled={loading} style={{ marginLeft: 'auto' }}>
          {loading ? <span className="btn-spinner small" /> : '↻ Refresh'}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="booking-loading"><div className="ub-spinner" /><p>Loading bookings…</p></div>
      ) : error ? (
        <div className="booking-error">
          <p>⚠ {error}</p>
          <button className="retry-btn" onClick={load}>Retry</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="booking-empty">
          <div className="empty-icon">📭</div>
          <h3>No bookings found</h3>
          <p>{filter === 'ALL' ? "You haven't made any bookings yet." : `No ${filter.toLowerCase()} bookings.`}</p>
          {filter === 'ALL' && (
            <button className="new-booking-btn" onClick={onNewBooking}>Make your first booking</button>
          )}
        </div>
      ) : (
        <div className="booking-list">
          {visible.map(b => {
            const displayStatus = getDisplayStatus(b);
            const st = STATUS_STYLE[displayStatus];
            const canCancel = b.status === 'PENDING' || b.status === 'APPROVED';
            return (
              <div key={b.id} className="booking-card">
                <div className="booking-card-top">
                  <div className="booking-resource">
                    <span className="resource-icon">🏢</span>
                    <div>
                      <div className="resource-name">{b.resourceName || b.resourceId}</div>
                      <div className="resource-id mono">{b.resourceId}</div>
                    </div>
                  </div>
                  <span
                    className="booking-status-badge"
                    style={{ color: st.color, background: st.bg }}
                  >
                    {st.label}
                  </span>
                </div>

                <div className="booking-times">
                  <div className="time-row">
                    <span className="time-label">From</span>
                    <span className="time-value">{formatTime(b.startTime)}</span>
                  </div>
                  <div className="time-row">
                    <span className="time-label">To</span>
                    <span className="time-value">{formatTime(b.endTime)}</span>
                  </div>
                  <div className="time-row">
                    <span className="time-label">Duration</span>
                    <span className="time-value">{duration(b.startTime, b.endTime)}</span>
                  </div>
                </div>

                <div className="booking-purpose">
                  <span className="purpose-label">Purpose</span>
                  <p className="purpose-text">{b.purpose}</p>
                </div>

                {displayStatus === 'ALTERNATIVE_SUGGESTED' && approvals[b.id]?.alternativeSlot && (
                  <div style={{ 
                    padding: '1rem', 
                    marginTop: '0.75rem',
                    backgroundColor: 'rgba(56,189,248,0.08)',
                    border: '1px solid rgba(56,189,248,0.3)',
                    borderRadius: '0.5rem'
                  }}>
                    <div style={{ color: '#38bdf8', fontWeight: 600, marginBottom: '0.5rem' }}>📅 Suggested Alternative Slot</div>
                    <div className="booking-times" style={{ marginTop: '0.5rem' }}>
                      <div className="time-row">
                        <span className="time-label">From</span>
                        <span className="time-value">{formatTime(approvals[b.id]!.alternativeSlot!.startTime)}</span>
                      </div>
                      <div className="time-row">
                        <span className="time-label">To</span>
                        <span className="time-value">{formatTime(approvals[b.id]!.alternativeSlot!.endTime)}</span>
                      </div>
                      <div className="time-row">
                        <span className="time-label">Duration</span>
                        <span className="time-value">{duration(approvals[b.id]!.alternativeSlot!.startTime, approvals[b.id]!.alternativeSlot!.endTime)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="booking-card-footer">
                  <div className="booking-meta">
                    <span>👥 {b.attendeeCount} attendees</span>
                    <span className="dot">·</span>
                    <span className="mono" style={{ fontSize: '0.7rem', opacity: 0.5 }}>
                      {b.id.slice(0, 8)}…
                    </span>
                    <span className="dot">·</span>
                    <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>
                      Booked {new Date(b.createdAt).toLocaleDateString()}
                    </span>
                    {b.status === 'CANCELLED' && (
                      <>
                        <span className="dot">·</span>
                        <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                          🚫 Cancelled by requester
                        </span>
                      </>
                    )}
                  </div>
                  {canCancel && (
                    <button
                      className="cancel-btn"
                      onClick={() => cancel(b.id)}
                      disabled={cancelling === b.id}
                    >
                      {cancelling === b.id ? <span className="btn-spinner small" /> : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
