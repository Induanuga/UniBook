// src/pages/DashboardPage.tsx
// UPDATED: Subsystem 5 — Notification Service wired in.
// UPDATED: Subsystem 6 — Analytics Service status + booking summary widget.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { bookingService } from '../services/bookingService';
import { notificationService } from '../services/notificationService';
import { analyticsService } from '../services/analyticsService';

const ROLE_CONFIG = {
  STUDENT: {
    label: 'Student',
    color: '#4ade80',
    bg: 'rgba(74,222,128,0.12)',
    icon: '🎓',
    description: 'Browse and book seminar rooms, labs, and equipment.',
    actions: [
      { label: 'Browse Resources',   icon: '🔍', desc: 'Find available rooms and labs',       tag: 'Live', page: 'resources' },
      { label: 'My Bookings',        icon: '📅', desc: 'View and manage your bookings',        tag: 'Live', page: 'my-bookings' },
      { label: 'Approval Status',    icon: '📋', desc: 'Track your booking approval status',   tag: 'Live', page: 'my-approval-status' },
      { label: 'My Notifications',   icon: '🔔', desc: 'View all your notifications',          tag: 'Live', page: 'notifications' },
    ],
  },
  FACULTY: {
    label: 'Faculty',
    color: '#60a5fa',
    bg: 'rgba(96,165,250,0.12)',
    icon: '👨\u200d🏫',
    description: 'Book teaching labs and seminar rooms. Approve student requests.',
    actions: [
      { label: 'Book a Resource',    icon: '➕', desc: 'Reserve a room or equipment',         tag: 'Live', page: 'new-booking' },
      { label: 'Pending Approvals',  icon: '✅', desc: 'Review student booking requests',      tag: 'Live', page: 'pending-approvals' },
      { label: 'My Schedule',        icon: '🗓️', desc: 'Your upcoming bookings',              tag: 'Live', page: 'my-bookings' },
      { label: 'My Notifications',   icon: '🔔', desc: 'View all your notifications',          tag: 'Live', page: 'notifications' },
    ],
  },
  ADMIN: {
    label: 'Administrator',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    icon: '🛡️',
    description: 'Manage resources, view usage analytics, configure policies.',
    actions: [
      { label: 'Pending Approvals',  icon: '📋', desc: 'Review escalated booking requests',   tag: 'Live', page: 'pending-approvals' },
      { label: 'Manage Resources',   icon: '🏢', desc: 'Add and configure resources',         tag: 'Live', page: 'admin-resources' },
      { label: 'My Notifications',   icon: '🔔', desc: 'View all your notifications',          tag: 'Live', page: 'notifications' },
      { label: 'Analytics',          icon: '📊', desc: 'Utilisation heatmaps and CSV export', tag: 'Live', page: 'analytics' },
      { label: 'Audit Log',          icon: '🔒', desc: 'All auth events and violations',      tag: 'Available now', page: 'audit' },
    ],
  },
  IT_STAFF: {
    label: 'IT Staff',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.12)',
    icon: '⚙️',
    description: 'Register resources, schedule maintenance windows, monitor health.',
    actions: [
      { label: 'Browse Catalogue',   icon: '🔍', desc: 'Search and view all resources',       tag: 'Live', page: 'resources' },
      { label: 'Maintenance Windows',icon: '🔧', desc: 'Schedule resource downtime',          tag: 'Live', page: 'admin-resources' },
      { label: 'My Notifications',   icon: '🔔', desc: 'View all your notifications',          tag: 'Live', page: 'notifications' },
      { label: 'Audit Log',          icon: '🔒', desc: 'All auth events and violations',      tag: 'Available now', page: 'audit' },
    ],
  },
};

const IAM_COMPONENTS = [
  { name: 'OAuthCallbackHandler', status: 'Online',    note: 'Email/password login · SSO-ready' },
  { name: 'JWTIssuer',            status: 'Online',    note: 'HS256 dev · RS256 prod · 8h TTL' },
  { name: 'JWTValidator',         status: 'Online',    note: 'Middleware on every protected route' },
  { name: 'RoleGuard',            status: 'Online',    note: 'STUDENT · FACULTY · ADMIN · IT_STAFF' },
  { name: 'AuditLogger',          status: 'Online',    note: 'Writes to audit_log on every auth event' },
  { name: 'TokenBlacklist',       status: 'Online',    note: 'Revokes tokens on logout · Redis in prod' },
  { name: 'SilentRefresh',        status: 'Scheduled', note: 'Proactive renewal 60s before expiry' },
];

const RESOURCE_CATALOGUE_COMPONENTS = [
  { name: 'ResourceRepository',        status: 'Online', note: 'Repository pattern · owns resources, resource_types, maintenance_windows' },
  { name: 'AvailabilityCacheManager',  status: 'Online', note: 'Proxy + Template Method · Redis read-through, write-invalidate on events' },
  { name: 'AvailabilityCalendarService', status: 'Online', note: 'Template Method · cache→DB→96 slots→populate skeleton' },
  { name: 'ResourceSearchEngine',      status: 'Online', note: 'Specification pattern · composable filter criteria, zero code changes for new filters' },
  { name: 'BookingEventListener',      status: 'Online', note: 'Observer webhook · Booking Engine events trigger immediate cache invalidation' },
  { name: 'RedisClient',               status: 'Online', note: 'Singleton · shared across all repositories, 30s availability TTL' },
];

const BOOKING_COMPONENTS = [
  { name: 'BookingFacade',           status: 'Online', note: 'Single entry point — orchestrates all booking steps' },
  { name: 'ConflictDetectionEngine', status: 'Online', note: 'SELECT FOR UPDATE · zero double-bookings' },
  { name: 'IdempotencyGuard',        status: 'Online', note: '24h deduplication window · UUID keys' },
  { name: 'BookingPolicyRegistry',   status: 'Online', note: 'Strategy pattern · FIFO / Priority / Quota' },
  { name: 'SlotSuggestionService',   status: 'Online', note: '3 nearest slots · 15-min aligned' },
  { name: 'EventBus',                status: 'Online', note: 'Observer pattern · publishes lifecycle events' },
  { name: 'BookingRepository',       status: 'Online', note: 'Optimistic locking · version column' },
];

const APPROVAL_COMPONENTS = [
  { name: 'ApprovalHandlerChain',  status: 'Online', note: 'Chain of Responsibility · STUDENT→Faculty, FACULTY→Admin' },
  { name: 'FacultyApprovalHandler',status: 'Online', note: 'Broadcasts to all faculty — first-one-wins model' },
  { name: 'AdminApprovalHandler',  status: 'Online', note: 'Handles escalated and FACULTY-submitted bookings' },
  { name: 'EscalationScheduler',   status: 'Online', note: 'Polls every 15 min · escalates after 24h inactivity' },
  { name: 'ApprovalRepository',    status: 'Online', note: 'Repository pattern · approval_requests & assignments' },
  { name: 'ApprovalService',       status: 'Online', note: 'Facade · processDecision, escalateToAdmin, notifyNotificationService' },
];

const NOTIFICATION_COMPONENTS = [
  { name: 'NotificationService',          status: 'Online', note: 'Facade · processEvent, getMyNotifications, markRead' },
  { name: 'InAppNotificationChannel',     status: 'Online', note: 'Strategy · stores notifications in Postgres DB' },
  { name: 'EmailNotificationChannel',     status: 'Online', note: 'Strategy · Nodemailer SMTP (disabled unless SMTP_HOST set)' },
  { name: 'NotificationChannelRegistry', status: 'Online', note: 'Strategy registry · selects channels per event type' },
  { name: 'NotificationRepository',       status: 'Online', note: 'Repository pattern · notifications table' },
  { name: 'WebhookHandler',               status: 'Online', note: 'Observer · receives events from Approval Workflow via HTTP POST' },
];

const ANALYTICS_COMPONENTS = [
  { name: 'AnalyticsService',        status: 'Online', note: 'Facade · single entry point for all analytics operations' },
  { name: 'AnalyticsEventConsumer',  status: 'Online', note: 'Observer · ingests BookingApproved / BookingCancelled events via webhook' },
  { name: 'UtilisationAggregator',   status: 'Online', note: 'Maintains materialised snapshot counts (+1/-1 per hour slot)' },
  { name: 'HeatmapBuilder',          status: 'Online', note: 'Reads utilisation_snapshots — never touches booking tables (NFR-1)' },
  { name: 'ReportExporter',          status: 'Online', note: 'CSV serialiser — exports raw analytics_events over custom date range' },
  { name: 'AnalyticsRepository',     status: 'Online', note: 'Repository pattern · analytics_events + utilisation_snapshots tables' },
];

type Tab = 'overview' | 'audit' | 'booking-status';

interface Props {
  onNavigate: (page: string) => void;
}

export function DashboardPage({ onNavigate }: Props) {
  const { user, accessToken, logout } = useAuth();
  const [loggingOut, setLoggingOut]   = useState(false);
  const [activeTab, setActiveTab]     = useState<Tab>('overview');
  const [auditLog, setAuditLog]       = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [bookingEngineOnline, setBookingEngineOnline] = useState<boolean | null>(null);
  const [catalogueOnline, setCatalogueOnline] = useState<boolean | null>(null);
  const [approvalWorkflowOnline, setApprovalWorkflowOnline] = useState<boolean | null>(null);
  const [notificationServiceOnline, setNotificationServiceOnline] = useState<boolean | null>(null);
  const [analyticsServiceOnline, setAnalyticsServiceOnline] = useState<boolean | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [bookingSummary, setBookingSummary] = useState<{ pending: number; approved: number; cancelled: number; rejected: number; alternative: number; total: number } | null>(null);

  if (!user) return null;

  const cfg          = ROLE_CONFIG[user.role];
  const canViewAudit = user.role === 'ADMIN' || user.role === 'IT_STAFF';

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };

  const fetchAuditLog = async () => {
    if (!canViewAudit || !accessToken) return;
    setAuditLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/auth/audit-log`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await res.json();
      setAuditLog(data.entries || []);
    } catch {
      // silently fail
    } finally {
      setAuditLoading(false);
    }
  };

  const checkBookingEngine = useCallback(async () => {
    try {
      await bookingService.health();
      setBookingEngineOnline(true);
    } catch {
      setBookingEngineOnline(false);
    }
  }, []);

  const checkCatalogue = useCallback(async () => {
    try {
      const { resourceService } = await import('../services/resourceService');
      await resourceService.health();
      setCatalogueOnline(true);
    } catch {
      setCatalogueOnline(false);
    }
  }, []);

  const checkApprovalWorkflow = useCallback(async () => {
    try {
      const approvalApiUrl = import.meta.env.VITE_APPROVAL_API_URL || 'http://localhost:3004';
      const res = await fetch(`${approvalApiUrl}/health`, { method: 'GET' });
      setApprovalWorkflowOnline(res.ok);
    } catch {
      setApprovalWorkflowOnline(false);
    }
  }, []);

  const checkNotificationService = useCallback(async () => {
    try {
      await notificationService.health();
      setNotificationServiceOnline(true);
    } catch {
      setNotificationServiceOnline(false);
    }
  }, []);

  const checkAnalyticsService = useCallback(async () => {
    try {
      await analyticsService.health();
      setAnalyticsServiceOnline(true);
    } catch {
      setAnalyticsServiceOnline(false);
    }
  }, []);

  const fetchBookingSummary = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [{ bookings }, { approvals }] = await Promise.all([
        bookingService.getMyBookings(accessToken),
        approvalService.getMyApprovals(accessToken).catch(() => ({ approvals: [] })),
      ]);
      const alternative = approvals.filter(a => a.status === 'ALTERNATIVE_SUGGESTED').length;
      setBookingSummary({
        pending:     bookings.filter(b => b.status === 'PENDING').length,
        approved:    bookings.filter(b => b.status === 'APPROVED').length,
        cancelled:   bookings.filter(b => b.status === 'CANCELLED').length,
        rejected:    bookings.filter(b => b.status === 'REJECTED').length,
        alternative,
        total:       bookings.length,
      });
    } catch { /* non-fatal */ }
  }, [accessToken]);

  const fetchUnreadCount = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await notificationService.getUnreadCount(accessToken);
      setUnreadCount(data.count);
    } catch { /* non-fatal */ }
  }, [accessToken]);

  useEffect(() => {
    if (activeTab === 'audit') fetchAuditLog();
    if (activeTab === 'booking-status') checkBookingEngine();
  }, [activeTab]);

  // Also ping booking engine, catalogue, approval workflow, and notification service on mount
  useEffect(() => { checkBookingEngine(); checkCatalogue(); checkApprovalWorkflow(); checkNotificationService(); checkAnalyticsService(); fetchUnreadCount(); fetchBookingSummary(); }, [checkBookingEngine, checkCatalogue, checkApprovalWorkflow, checkNotificationService, checkAnalyticsService, fetchUnreadCount, fetchBookingSummary]);

  const handleActionClick = (page: string | null, tag: string) => {
    if (!page) return; // "Coming soon" — no-op
    if (page === 'audit') { setActiveTab('audit'); return; }
    onNavigate(page);
  };

  return (
    <div className="dash-root">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="dash-sidebar">
        <div className="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="10" fill="url(#dlg)" />
            <path d="M18 9l9 4v14l-9 4" stroke="white" strokeWidth="2" strokeLinejoin="round" />
            <path d="M18 9l-9 4v14l9 4" stroke="white" strokeWidth="2" strokeLinejoin="round" />
            <path d="M9 13l9 4 9-4"      stroke="white" strokeWidth="2" strokeLinejoin="round" />
            <path d="M18 17v10"           stroke="white" strokeWidth="2" />
            <defs>
              <linearGradient id="dlg" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
          </svg>
          <span>UniBook</span>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            <span className="nav-dot" style={{ background: cfg.color }} /> Overview
          </button>
          <button className={`nav-item ${activeTab === 'booking-status' ? 'active' : ''}`} onClick={() => setActiveTab('booking-status')}>
            <span className="nav-dot" style={{ background: '#4ade80' }} /> Booking Engine
          </button>
          {canViewAudit && (
            <button className={`nav-item ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
              <span className="nav-dot" style={{ background: '#f59e0b' }} /> Audit Log
            </button>
          )}
        </nav>

        <div className="sidebar-user">
          <div className="user-avatar" style={{ background: cfg.bg, color: cfg.color }}>{initials}</div>
          <div className="user-info">
            <span className="user-name">{user.name}</span>
            <span className="user-dept">{user.department || user.role}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout} disabled={loggingOut} title="Sign out">
            {loggingOut
              ? <span className="btn-spinner small" />
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
            }
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="dash-main">
        <header className="dash-header">
          <div>
            <h1 className="dash-greeting">Welcome back, {user.name.split(' ')[0]} 👋</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* 🔔 Notification Bell */}
            <button
              id="notification-bell"
              onClick={() => onNavigate('notifications')}
              title="My Notifications"
              style={{
                position: 'relative', background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.25)', borderRadius: 10,
                padding: '6px 10px', cursor: 'pointer', color: '#818cf8',
                display: 'flex', alignItems: 'center', fontSize: '1.1rem',
                transition: 'background 0.2s',
              }}
            >
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -6, right: -6,
                  background: '#f87171', color: 'white', borderRadius: '50%',
                  width: 18, height: 18, fontSize: '0.7rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1,
                }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
            <div className="role-badge" style={{ background: cfg.bg, color: cfg.color }}>
              <span>{cfg.icon}</span> {cfg.label}
            </div>
          </div>
        </header>

        {/* ── Overview Tab ── */}
        {activeTab === 'overview' && (
          <>
            <div className="info-grid">
              <div className="info-card highlight">
                <div className="card-label">Authenticated Session</div>
                <div className="card-value success">● Active</div>
                <p className="card-desc">JWT access token valid · Auto-refreshes before expiry</p>
              </div>
              <div className="info-card">
                <div className="card-label">Role</div>
                <div className="card-value" style={{ color: cfg.color }}>{cfg.label}</div>
                <p className="card-desc">{cfg.description}</p>
              </div>
              <div className="info-card">
                <div className="card-label">Email</div>
                <div className="card-value" style={{ fontSize: '1rem' }}>{user.email}</div>
                <p className="card-desc">{user.department || 'No department set'}</p>
              </div>
              <div className="info-card">
                <div className="card-label">Booking Engine</div>
                <div className="card-value" style={{ color: bookingEngineOnline === null ? '#6b7280' : bookingEngineOnline ? '#4ade80' : '#f87171' }}>
                  {bookingEngineOnline === null ? '● Checking…' : bookingEngineOnline ? '● Online' : '● Offline'}
                </div>
                <p className="card-desc">Subsystem 3 · port 3002</p>
              </div>
              <div className="info-card">
                <div className="card-label">Resource Catalogue</div>
                <div className="card-value" style={{ color: catalogueOnline === null ? '#6b7280' : catalogueOnline ? '#4ade80' : '#f87171' }}>
                  {catalogueOnline === null ? '● Checking…' : catalogueOnline ? '● Online' : '● Offline'}
                </div>
                <p className="card-desc">Subsystem 2 · port 3003</p>
              </div>
              <div className="info-card">
                <div className="card-label">Approval Workflow</div>
                <div className="card-value" style={{ color: approvalWorkflowOnline === null ? '#6b7280' : approvalWorkflowOnline ? '#4ade80' : '#f87171' }}>
                  {approvalWorkflowOnline === null ? '● Checking…' : approvalWorkflowOnline ? '● Online' : '● Offline'}
                </div>
                <p className="card-desc">Subsystem 4 · port 3004</p>
              </div>
              <div className="info-card">
                <div className="card-label">Notification Service</div>
                <div className="card-value" style={{ color: notificationServiceOnline === null ? '#6b7280' : notificationServiceOnline ? '#4ade80' : '#f87171' }}>
                  {notificationServiceOnline === null ? '● Checking…' : notificationServiceOnline ? '● Online' : '● Offline'}
                </div>
                <p className="card-desc">Subsystem 5 · port 3005</p>
              </div>
              <div className="info-card">
                <div className="card-label">Analytics Service</div>
                <div className="card-value" style={{ color: analyticsServiceOnline === null ? '#6b7280' : analyticsServiceOnline ? '#4ade80' : '#f87171' }}>
                  {analyticsServiceOnline === null ? '● Checking…' : analyticsServiceOnline ? '● Online' : '● Offline'}
                </div>
                <p className="card-desc">Subsystem 6 · port 3006</p>
              </div>
            </div>

            {/* ── Booking Summary (live) ── */}
            {bookingSummary !== null && (
              <div className="subsystem-card" style={{ marginBottom: 0 }}>
                <div className="audit-header">
                  <h2 className="section-title">My Bookings — Summary</h2>
                  <button
                    className="refresh-btn"
                    onClick={fetchBookingSummary}
                    style={{ fontSize: '0.8rem' }}
                  >
                    ↻ Refresh
                  </button>
                </div>
                <div className="component-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  {[
                    { label: '✅ Approved',     count: bookingSummary.approved,    color: '#4ade80', note: 'Confirmed bookings' },
                    { label: '⏳ Pending',      count: bookingSummary.pending,     color: '#f59e0b', note: 'Awaiting approval' },
                    { label: '❌ Rejected',     count: bookingSummary.rejected,    color: '#f87171', note: 'Not approved' },
                    { label: '🚫 Cancelled',    count: bookingSummary.cancelled,   color: '#6b7280', note: 'Cancelled by you' },
                    { label: '📅 Alt. Suggested', count: bookingSummary.alternative, color: '#38bdf8', note: 'Approver suggested another slot' },
                    { label: '📋 Total',        count: bookingSummary.total,       color: '#818cf8', note: 'All bookings' },
                  ].map(({ label, count, color, note }) => (
                    <div
                      key={label}
                      className="component-item clickable-action"
                      style={{ cursor: 'pointer', borderLeft: `3px solid ${color}` }}
                      onClick={() => onNavigate('my-bookings')}
                    >
                      <div className="component-header">
                        <span className="component-name">{label}</span>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{count}</span>
                      </div>
                      <p className="component-note">{note}</p>
                      <span className="action-arrow">→</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="subsystem-card">
              <h2 className="section-title">Available Actions</h2>              <div className="component-grid">
                {cfg.actions.map((action) => {
                  const isLive = action.tag === 'Live' || action.tag === 'Available now';
                  const clickable = !!action.page;
                  return (
                    <div
                      key={action.label}
                      className={`component-item ${clickable ? 'clickable-action' : ''}`}
                      onClick={() => handleActionClick(action.page, action.tag)}
                      style={{ cursor: clickable ? 'pointer' : 'default' }}
                    >
                      <div className="component-header">
                        <span className="component-name">{action.icon} {action.label}</span>
                        <span className={`component-status ${isLive ? 'online' : 'scheduled'}`}>
                          {action.tag}
                        </span>
                      </div>
                      <p className="component-note">{action.desc}</p>
                      {clickable && <span className="action-arrow">→</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="subsystem-card">
              <h2 className="section-title">IAM Subsystem — Component Status</h2>
              <div className="component-grid">
                {IAM_COMPONENTS.map((c) => (
                  <div key={c.name} className="component-item">
                    <div className="component-header">
                      <span className="component-name">{c.name}</span>
                      <span className={`component-status ${c.status === 'Online' ? 'online' : 'scheduled'}`}>{c.status}</span>
                    </div>
                    <p className="component-note">{c.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="subsystem-card">
              <div className="audit-header">
                <h2 className="section-title">Resource Catalogue — Component Status</h2>
                <span style={{
                  padding: '4px 12px', borderRadius: 99, fontSize: '0.8rem',
                  background: catalogueOnline ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                  color: catalogueOnline ? '#4ade80' : '#f87171',
                }}>
                  {catalogueOnline === null ? 'Checking...' : catalogueOnline ? '● Online — port 3003' : '● Offline — start with npm run dev'}
                </span>
              </div>
              <div className="component-grid">
                {RESOURCE_CATALOGUE_COMPONENTS.map((c) => (
                  <div key={c.name} className="component-item clickable-action" style={{ cursor: 'pointer' }} onClick={() => onNavigate('resources')}>
                    <div className="component-header">
                      <span className="component-name">{c.name}</span>
                      <span className={`component-status ${catalogueOnline ? 'online' : 'scheduled'}`}>
                        {catalogueOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <p className="component-note">{c.note}</p>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                <div className="component-item clickable-action" style={{ cursor: 'pointer', flex: 1 }} onClick={() => onNavigate('resources')}>
                  <div className="component-header">
                    <span className="component-name">🔍 Browse Resources</span>
                    <span className="component-status online">Live</span>
                  </div>
                  <p className="component-note">Search and filter the university resource catalogue</p>
                  <span className="action-arrow">→</span>
                </div>
              </div>
            </div>

            <div className="subsystem-card">
              <div className="audit-header">
                <h2 className="section-title">Approval Workflow — Component Status</h2>
                <span style={{
                  padding: '4px 12px', borderRadius: 99, fontSize: '0.8rem',
                  background: 'rgba(129,140,248,0.12)', color: '#4ade80',
                }}>
                  ● Online — port 3004
                </span>
              </div>
              <div className="component-grid">
                {APPROVAL_COMPONENTS.map((c) => (
                  <div key={c.name} className="component-item">
                    <div className="component-header">
                      <span className="component-name">{c.name}</span>
                      <span className="component-status online">{c.status}</span>
                    </div>
                    <p className="component-note">{c.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="subsystem-card">
              <div className="audit-header">
                <h2 className="section-title">Notification Service — Component Status</h2>
                <span style={{
                  padding: '4px 12px', borderRadius: 99, fontSize: '0.8rem',
                  background: notificationServiceOnline ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                  color: notificationServiceOnline ? '#4ade80' : '#f87171',
                }}>
                  {notificationServiceOnline === null ? 'Checking...' : notificationServiceOnline ? '● Online — port 3005' : '● Offline — start with npm run dev'}
                </span>
              </div>
              <div className="component-grid">
                {NOTIFICATION_COMPONENTS.map((c) => (
                  <div key={c.name} className="component-item clickable-action" style={{ cursor: 'pointer' }} onClick={() => onNavigate('notifications')}>
                    <div className="component-header">
                      <span className="component-name">{c.name}</span>
                      <span className={`component-status ${notificationServiceOnline ? 'online' : 'scheduled'}`}>
                        {notificationServiceOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <p className="component-note">{c.note}</p>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                <div className="component-item clickable-action" style={{ cursor: 'pointer', flex: 1 }} onClick={() => onNavigate('notifications')}>
                  <div className="component-header">
                    <span className="component-name">🔔 My Notifications</span>
                    <span className="component-status online">Live</span>
                  </div>
                  <p className="component-note">View and manage your notifications ({unreadCount} unread)</p>
                  <span className="action-arrow">→</span>
                </div>
              </div>
            </div>

            {/* ── Analytics & Reporting (Admin only) ── */}
            {user.role === 'ADMIN' && (
              <div className="subsystem-card">
                <div className="audit-header">
                  <h2 className="section-title">Analytics & Reporting — Component Status</h2>
                  <span style={{
                    padding: '4px 12px', borderRadius: 99, fontSize: '0.8rem',
                    background: analyticsServiceOnline ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                    color: analyticsServiceOnline ? '#4ade80' : '#f87171',
                  }}>
                    {analyticsServiceOnline === null ? 'Checking...' : analyticsServiceOnline ? '● Online — port 3006' : '● Offline — start with npm run dev'}
                  </span>
                </div>
                <div className="component-grid">
                  {ANALYTICS_COMPONENTS.map((c) => (
                    <div key={c.name} className="component-item clickable-action" style={{ cursor: 'pointer' }} onClick={() => onNavigate('analytics')}>
                      <div className="component-header">
                        <span className="component-name">{c.name}</span>
                        <span className={`component-status ${analyticsServiceOnline ? 'online' : 'scheduled'}`}>
                          {analyticsServiceOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <p className="component-note">{c.note}</p>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                  <div className="component-item clickable-action" style={{ cursor: 'pointer', flex: 1 }} onClick={() => onNavigate('analytics')}>
                    <div className="component-header">
                      <span className="component-name">📊 Analytics Dashboard</span>
                      <span className="component-status online">Live</span>
                    </div>
                    <p className="component-note">Utilisation heatmaps, booking summaries, and CSV export</p>
                    <span className="action-arrow">→</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Booking Engine Tab ── */}
        {activeTab === 'booking-status' && (
          <>
            <div className="subsystem-card">
              <div className="audit-header">
                <h2 className="section-title">Booking Engine — Component Status</h2>
                <span style={{
                  padding: '4px 12px', borderRadius: 99, fontSize: '0.8rem',
                  background: bookingEngineOnline ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                  color: bookingEngineOnline ? '#4ade80' : '#f87171',
                }}>
                  {bookingEngineOnline === null ? 'Checking…' : bookingEngineOnline ? '● Online — port 3002' : '● Offline — start with npm run dev'}
                </span>
              </div>
              <div className="component-grid">
                {BOOKING_COMPONENTS.map((c) => (
                  <div key={c.name} className="component-item">
                    <div className="component-header">
                      <span className="component-name">{c.name}</span>
                      <span className={`component-status ${bookingEngineOnline ? 'online' : 'scheduled'}`}>
                        {bookingEngineOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <p className="component-note">{c.note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Approval Workflow */}
            <div className="subsystem-card">
              <div className="audit-header">
                <h2 className="section-title">Approval Workflow — Component Status</h2>
                <span style={{
                  padding: '4px 12px', borderRadius: 99, fontSize: '0.8rem',
                  background: 'rgba(129,140,248,0.12)', color: '#818cf8',
                }}>
                  ● Online — port 3004
                </span>
              </div>
              <div className="component-grid">
                {APPROVAL_COMPONENTS.map((c) => (
                  <div key={c.name} className="component-item">
                    <div className="component-header">
                      <span className="component-name">{c.name}</span>
                      <span className="component-status online">{c.status}</span>
                    </div>
                    <p className="component-note">{c.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="subsystem-card">
              <h2 className="section-title">Quick Actions</h2>
              <div className="component-grid">
                <div className="component-item clickable-action" style={{ cursor: 'pointer' }} onClick={() => onNavigate('new-booking')}>
                  <div className="component-header">
                    <span className="component-name">➕ New Booking</span>
                    <span className="component-status online">Live</span>
                  </div>
                  <p className="component-note">Submit a resource booking request</p>
                  <span className="action-arrow">→</span>
                </div>
                <div className="component-item clickable-action" style={{ cursor: 'pointer' }} onClick={() => onNavigate('my-bookings')}>
                  <div className="component-header">
                    <span className="component-name">📅 My Bookings</span>
                    <span className="component-status online">Live</span>
                  </div>
                  <p className="component-note">View and cancel your bookings</p>
                  <span className="action-arrow">→</span>
                </div>
                <div className="component-item clickable-action" style={{ cursor: 'pointer' }} onClick={() => onNavigate('pending-approvals')}>
                  <div className="component-header">
                    <span className="component-name">✅ Pending Approvals</span>
                    <span className="component-status online">Live</span>
                  </div>
                  <p className="component-note">Review and decide on booking requests</p>
                  <span className="action-arrow">→</span>
                </div>
                <div className="component-item clickable-action" style={{ cursor: 'pointer' }} onClick={() => onNavigate('my-approval-status')}>
                  <div className="component-header">
                    <span className="component-name">🔍 Approval Status</span>
                    <span className="component-status online">Live</span>
                  </div>
                  <p className="component-note">Track your submitted bookings' approval</p>
                  <span className="action-arrow">→</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Audit Tab ── */}
        {activeTab === 'audit' && canViewAudit && (
          <div className="subsystem-card">
            <div className="audit-header">
              <h2 className="section-title">Audit Log</h2>
              <button className="refresh-btn" onClick={fetchAuditLog} disabled={auditLoading}>
                {auditLoading ? <span className="btn-spinner small" /> : '↻ Refresh'}
              </button>
            </div>
            {auditLoading ? (
              <div className="audit-loading"><div className="ub-spinner" /></div>
            ) : auditLog.length === 0 ? (
              <p className="audit-empty">No audit entries yet.</p>
            ) : (
              <div className="audit-table-wrap">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th>Time</th><th>Action</th><th>Actor</th>
                      <th>Role</th><th>Endpoint</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry: any) => (
                      <tr key={entry.id}>
                        <td className="mono">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                        <td><span className="audit-action">{entry.action}</span></td>
                        <td className="truncate">{entry.actorEmail}</td>
                        <td>{entry.rolePresented || '—'}</td>
                        <td className="mono truncate">{entry.method} {entry.endpoint}</td>
                        <td>
                          <span className={`audit-status ${entry.success ? 'ok' : 'fail'}`}>
                            {entry.success ? '✓ OK' : '✗ FAIL'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
