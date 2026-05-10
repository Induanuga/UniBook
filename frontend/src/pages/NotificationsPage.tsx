// src/pages/NotificationsPage.tsx
// Subsystem 5 — In-App Notification Center
// Shows all notifications for the authenticated user, with mark-as-read controls.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { notificationService, type AppNotification } from '../services/notificationService';

const EVENT_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  BOOKING_APPROVED:      { bg: 'rgba(74,222,128,0.10)',  color: '#4ade80', border: 'rgba(74,222,128,0.3)'  },
  BOOKING_REJECTED:      { bg: 'rgba(248,113,113,0.10)', color: '#f87171', border: 'rgba(248,113,113,0.3)' },
  ALTERNATIVE_SUGGESTED: { bg: 'rgba(251,191,36,0.10)',  color: '#fbbf24', border: 'rgba(251,191,36,0.3)'  },
  ASSIGNMENT_PENDING:    { bg: 'rgba(96,165,250,0.10)',  color: '#60a5fa', border: 'rgba(96,165,250,0.3)'  },
  ESCALATION_ASSIGNED:   { bg: 'rgba(167,139,250,0.10)', color: '#a78bfa', border: 'rgba(167,139,250,0.3)' },
  BOOKING_SUBMITTED:     { bg: 'rgba(99,102,241,0.10)',  color: '#818cf8', border: 'rgba(99,102,241,0.3)'  },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

interface Props {
  onBack: () => void;
}

export function NotificationsPage({ onBack }: Props) {
  const { accessToken } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [markingAll, setMarkingAll]       = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const data = await notificationService.getMyNotifications(accessToken);
      setNotifications(data.notifications);
    } catch {
      setError('Could not load notifications. Is the Notification Service running?');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  const handleMarkRead = async (id: string) => {
    if (!accessToken) return;
    try {
      const data = await notificationService.markRead(id, accessToken);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? data.notification : n)),
      );
    } catch { /* ignore */ }
  };

  const handleMarkAllRead = async () => {
    if (!accessToken) return;
    setMarkingAll(true);
    try {
      await notificationService.markAllRead(accessToken);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="dash-root" style={{ '--accent': '#818cf8' } as React.CSSProperties}>
      <aside className="dash-sidebar">
        <div className="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="10" fill="url(#nlg)" />
            <path d="M18 8v2M8 18h2M26 18h2M18 26v2" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="18" cy="18" r="6" stroke="white" strokeWidth="2"/>
            <circle cx="18" cy="18" r="2" fill="white"/>
            <defs>
              <linearGradient id="nlg" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6366f1"/><stop offset="1" stopColor="#8b5cf6"/>
              </linearGradient>
            </defs>
          </svg>
          <span>UniBook</span>
        </div>
        <nav className="sidebar-nav">
          <button className="nav-item active">
            <span className="nav-dot" style={{ background: '#818cf8' }} /> Notifications
          </button>
        </nav>
      </aside>

      <main className="dash-main">
        <header className="dash-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onBack} style={{
              background: 'rgba(99,102,241,0.12)', border: 'none', color: '#818cf8',
              borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: '0.9rem',
            }}>← Back</button>
            <h1 className="dash-greeting" style={{ margin: 0 }}>🔔 Notifications</h1>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              style={{
                background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                color: '#818cf8', borderRadius: 8, padding: '6px 16px', cursor: 'pointer',
                fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {markingAll ? <span className="btn-spinner small" /> : null}
              Mark all read ({unreadCount})
            </button>
          )}
        </header>

        <div className="subsystem-card">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <div className="ub-spinner" />
            </div>
          ) : error ? (
            <div style={{ padding: 24, color: '#f87171', textAlign: 'center' }}>
              <p>{error}</p>
              <button onClick={loadNotifications} style={{
                marginTop: 12, background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
                color: '#f87171', borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
              }}>↻ Retry</button>
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔕</div>
              <p style={{ fontSize: '1.05rem' }}>No notifications yet.</p>
              <p style={{ fontSize: '0.9rem', marginTop: 4 }}>
                Notifications will appear here when bookings are approved, rejected, or need your review.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notifications.map((notif) => {
                const style = EVENT_COLORS[notif.eventType] ?? EVENT_COLORS.BOOKING_SUBMITTED;
                return (
                  <div
                    key={notif.id}
                    style={{
                      background:   notif.isRead ? 'rgba(255,255,255,0.03)' : style.bg,
                      border:       `1px solid ${notif.isRead ? 'rgba(255,255,255,0.06)' : style.border}`,
                      borderRadius: 12,
                      padding:      '14px 18px',
                      display:      'flex',
                      alignItems:   'flex-start',
                      gap:          14,
                      transition:   'background 0.2s',
                    }}
                  >
                    {/* Unread dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 6,
                      background: notif.isRead ? 'transparent' : style.color,
                    }} />

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{
                          fontWeight: notif.isRead ? 400 : 600,
                          color:      notif.isRead ? '#9ca3af' : style.color,
                          fontSize:  '0.95rem',
                        }}>
                          {notif.title}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: '#6b7280', whiteSpace: 'nowrap', marginLeft: 12 }}>
                          {formatDate(notif.createdAt)}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.88rem', color: '#9ca3af', lineHeight: 1.5 }}>
                        {notif.message}
                      </p>
                    </div>

                    {!notif.isRead && (
                      <button
                        onClick={() => handleMarkRead(notif.id)}
                        title="Mark as read"
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px',
                          color: '#6b7280', fontSize: '0.8rem', flexShrink: 0, borderRadius: 4,
                        }}
                      >
                        ✓
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
