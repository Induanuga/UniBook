// src/pages/LoginPage.tsx
import { useState, FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { SignupPage } from './SignupPage';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// const DEMO_ACCOUNTS = [
//   { label: 'Student',  email: 'alice.student@university.edu', password: 'Password@123', color: '#4ade80', icon: '🎓' },
//   { label: 'Faculty',  email: 'bob.faculty@university.edu',   password: 'Password@123', color: '#60a5fa', icon: '👨‍🏫' },
//   { label: 'Admin',    email: 'carol.admin@university.edu',   password: 'Password@123', color: '#f59e0b', icon: '🛡️' },
//   { label: 'IT Staff', email: 'dave.it@university.edu',       password: 'Password@123', color: '#a78bfa', icon: '⚙️' },
// ];

export function LoginPage() {
  const { login }               = useAuth();
  const [showSignup, setShowSignup] = useState(false);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  if (showSignup) {
    return <SignupPage onSwitchToLogin={() => setShowSignup(false)} />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCasLogin = () => {
    // Redirect the browser to the backend CAS login initiator.
    // The backend will redirect to the university CAS server.
    window.location.href = `${API_BASE}/auth/cas/login`;
  };

  // const fillDemo = (acc: typeof DEMO_ACCOUNTS[0]) => {
  //   setEmail(acc.email);
  //   setPassword(acc.password);
  //   setError('');
  // };

  return (
    <div className="login-root">
      <div className="login-bg">
        <div className="blob blob-1" /><div className="blob blob-2" />
        <div className="grid-overlay" />
      </div>

      <div className="login-card">
        {/* Logo & header */}
        <div className="login-header">
          <div className="login-logo">
            <svg width="40" height="40" viewBox="0 0 36 36" fill="none">
              <rect width="36" height="36" rx="10" fill="url(#lg)" />
              <path d="M9 27V13l9-4 9 4v14l-9 4-9-4Z" fill="white" opacity="0.15" />
              <path d="M18 9l9 4v14l-9 4" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M18 9l-9 4v14l9 4" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M9 13l9 4 9-4" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M18 17v10" stroke="white" strokeWidth="2" />
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="login-title">UniBook</h1>
          <p className="login-subtitle">University Resource Booking System</p>
        </div>

        {/* ── CAS SSO Button ─────────────────────────────────────────────── */}
        <button className="cas-btn" onClick={handleCasLogin}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
          Login with University SSO
        </button>

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div className="or-divider">
          <span>or sign in with email</span>
        </div>

        {/* ── Email / Password Form ──────────────────────────────────────── */}
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="field-group">
            <label htmlFor="email" className="field-label">University Email</label>
            <div className="field-wrap">
              <svg className="field-icon" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
              </svg>
              <input
                id="email" type="email" className="field-input"
                placeholder="you@university.edu"
                value={email} onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email" disabled={loading}
              />
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="password" className="field-label">Password</label>
            <div className="field-wrap">
              <svg className="field-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <input
                id="password" type={showPass ? 'text' : 'password'} className="field-input"
                placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                required autoComplete="current-password" disabled={loading}
              />
              <button type="button" className="field-toggle" onClick={() => setShowPass(v => !v)}>
                {showPass
                  ? <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>
                  : <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
                }
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
              </svg>
              {error}
            </div>
          )}

          <button type="submit" className="login-btn" disabled={loading || !email || !password}>
            {loading
              ? <><span className="btn-spinner" /> Authenticating…</>
              : <>Sign In <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd"/></svg></>
            }
          </button>
        </form>

        {/* Demo accounts */}
        {/* <div className="demo-section">
          <div className="demo-divider"><span>Quick Demo</span></div>
          <div className="demo-grid">
            {DEMO_ACCOUNTS.map((acc) => (
              <button key={acc.label} className="demo-chip" onClick={() => fillDemo(acc)}
                disabled={loading} style={{ '--chip-color': acc.color } as React.CSSProperties}>
                <span className="chip-icon">{acc.icon}</span>{acc.label}
              </button>
            ))}
          </div>
          <p className="demo-hint">Click a role to auto-fill credentials</p>
        </div> */}

        <div className="login-footer-row">
          {/* <p className="login-footer">JWT · 8h sessions · Role-based access</p> */}
          <button className="switch-btn" onClick={() => setShowSignup(true)}>
            Create account →
          </button>
        </div>
      </div>
    </div>
  );
}
