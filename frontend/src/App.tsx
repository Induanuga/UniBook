// src/App.tsx
// UPDATED: Added routing for Subsystem 4 (Approval Workflow) pages.
// New pages: 'pending-approvals' (FACULTY/ADMIN), 'my-approval-status' (STUDENT)
import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage }                from './pages/LoginPage';
import { DashboardPage }            from './pages/DashboardPage';
import { CasCallbackPage }          from './pages/CasCallbackPage';
import { MyBookingsPage }           from './pages/MyBookingsPage';
import { NewBookingPage }           from './pages/NewBookingPage';
import { ResourceBrowserPage }      from './pages/ResourceBrowserPage';
import { ResourceDetailPage }       from './pages/ResourceDetailPage';
import { AdminResourcesPage }       from './pages/AdminResourcesPage';
import { PendingApprovalsPage }     from './pages/PendingApprovalsPage';
import { MyApprovalStatusPage }     from './pages/MyApprovalStatusPage';
import { NotificationsPage }        from './pages/NotificationsPage';
import { AnalyticsDashboardPage }   from './pages/AnalyticsDashboardPage';
import type { Resource }            from './types/resource';
import type { Booking }             from './services/bookingService';

import './App.css';

type Page =
  | 'dashboard'
  | 'my-bookings'
  | 'new-booking'
  | 'resources'
  | 'resource-detail'
  | 'admin-resources'
  | 'pending-approvals'
  | 'my-approval-status'
  | 'notifications'
  | 'analytics';

function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth();
  const [page, setPage]                         = useState<Page>('dashboard');
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [preselectedStart, setPreselectedStart] = useState<string | undefined>();

  if (window.location.pathname === '/cas-callback') {
    return <CasCallbackPage />;
  }

  if (isLoading) {
    return (
      <div className="ub-loading-screen">
        <div className="ub-spinner" />
        <p>Loading UniBook...</p>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  const goHome = () => {
    setPage('dashboard');
    setSelectedResource(null);
    setPreselectedStart(undefined);
  };

  const goTo = (p: string) => {
    setPreselectedStart(undefined);
    setPage(p as Page);
  };

  // ── Subsystem 5: Notification pages ─────────────────────────────────────────
  if (page === 'notifications') {
    return <NotificationsPage onBack={goHome} />;
  }

  // ── Subsystem 6: Analytics & Reporting pages ──────────────────────────────
  if (page === 'analytics') {
    return <AnalyticsDashboardPage onBack={goHome} />;
  }

  // ── Subsystem 4: Approval Workflow pages ─────────────────────────────────────
  if (page === 'pending-approvals') {
    return <PendingApprovalsPage onBack={goHome} />;
  }

  if (page === 'my-approval-status') {
    return <MyApprovalStatusPage onBack={goHome} />;
  }

  // ── Subsystem 2: Resource Catalogue pages ────────────────────────────────────
  if (page === 'resources') {
    return (
      <ResourceBrowserPage
        onBack={goHome}
        onViewResource={(r) => {
          setSelectedResource(r);
          setPage('resource-detail');
        }}
        onBookResource={(r) => {
          setSelectedResource(r);
          setPreselectedStart(undefined);
          setPage('new-booking');
        }}
        onAdminPanel={() => setPage('admin-resources')}
      />
    );
  }

  if (page === 'resource-detail' && selectedResource) {
    return (
      <ResourceDetailPage
        resource={selectedResource}
        onBack={() => setPage('resources')}
        onBook={(resource, startTime) => {
          setSelectedResource(resource);
          setPreselectedStart(startTime);
          setPage('new-booking');
        }}
      />
    );
  }

  if (page === 'admin-resources') {
    return (
      <AdminResourcesPage
        onBack={goHome}
        onViewResource={(r) => {
          setSelectedResource(r);
          setPage('resource-detail');
        }}
      />
    );
  }

  // ── Subsystem 3: Booking Engine pages ────────────────────────────────────────
  if (page === 'my-bookings') {
    return (
      <MyBookingsPage
        onBack={goHome}
        onNewBooking={() => setPage('new-booking')}
      />
    );
  }

  if (page === 'new-booking') {
    return (
      <NewBookingPage
        onBack={goHome}
        onSuccess={(_booking: Booking) => setPage('my-bookings')}
        preselectedResource={selectedResource ?? undefined}
        preselectedStartTime={preselectedStart}
        onBrowseResources={() => setPage('resources')}
      />
    );
  }

  return <DashboardPage onNavigate={goTo} />;
}

function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

export default App;