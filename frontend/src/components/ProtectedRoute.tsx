// src/components/ProtectedRoute.tsx
// Wraps any route that requires authentication (and optionally a specific role).

import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/auth';

interface Props {
  children: ReactNode;
  allowedRoles?: UserRole[];
  fallback?: ReactNode;
}

export function ProtectedRoute({ children, allowedRoles, fallback }: Props) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="ub-loading-screen">
        <div className="ub-spinner" />
        <p>Verifying session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return fallback ?? <RedirectToLogin />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <AccessDenied requiredRoles={allowedRoles} userRole={user.role} />;
  }

  return <>{children}</>;
}

function RedirectToLogin() {
  // In a real app with react-router, you'd use <Navigate to="/login" />.
  // Here we just render a message since the App handles routing via state.
  return (
    <div className="ub-access-denied">
      <h2>Session Required</h2>
      <p>Please log in to access this page.</p>
    </div>
  );
}

function AccessDenied({ requiredRoles, userRole }: { requiredRoles: UserRole[]; userRole: UserRole }) {
  return (
    <div className="ub-access-denied">
      <div className="ub-access-denied-icon">🔒</div>
      <h2>Access Denied</h2>
      <p>
        Your role <strong>{userRole}</strong> does not have permission to view this page.
      </p>
      <p className="ub-muted">Required: {requiredRoles.join(' or ')}</p>
    </div>
  );
}
