// src/pages/CasCallbackPage.tsx
// Landing page after CAS redirects back with tokens in the URL hash.

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { tokenStorage } from '../utils/tokenStorage';

export function CasCallbackPage() {
  const { refreshSession }      = useAuth();
  const [status, setStatus]     = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const hash   = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);

    const error        = params.get('error');
    const accessToken  = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    const expiresIn    = params.get('expiresIn');
    const userJson     = params.get('user');

    if (error) {
      setErrorMsg(decodeURIComponent(error));
      setStatus('error');
      return;
    }

    if (!accessToken || !refreshToken || !expiresIn || !userJson) {
      setErrorMsg('Incomplete session data from university login. Please try again.');
      setStatus('error');
      return;
    }

    try {
      const user = JSON.parse(decodeURIComponent(userJson));

      // isCas=true — marks this session as CAS so logout knows to call CAS logout
      tokenStorage.saveSession(
        accessToken,
        refreshToken,
        parseInt(expiresIn, 10),
        user,
        true   // ← isCas flag
      );

      // Remove tokens from URL bar and history
      window.history.replaceState(null, '', '/');

      // Reload auth state from storage → renders DashboardPage
      refreshSession();

    } catch {
      setErrorMsg('Failed to read session data from university login. Please try again.');
      setStatus('error');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'error') {
    return (
      <div className="login-root">
        <div className="login-bg">
          <div className="blob blob-1" /><div className="blob blob-2" />
          <div className="grid-overlay" />
        </div>
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: 8 }}>
            University Login Failed
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: 24, lineHeight: 1.5 }}>
            {errorMsg}
          </p>
          <button
            className="login-btn"
            onClick={() => {
              window.history.replaceState(null, '', '/');
              window.location.reload();
            }}
          >
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ub-loading-screen">
      <div className="ub-spinner" />
      <p style={{ color: 'var(--muted)', marginTop: 12 }}>
        Completing university login…
      </p>
    </div>
  );
}
