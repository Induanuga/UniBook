// src/pages/SignupPage.tsx
import { useState, FormEvent, ChangeEvent } from 'react';
import { authService } from '../services/authService';

const ROLES = [
  { value: 'STUDENT',  label: 'Student',  icon: '🎓', desc: 'Browse and book resources' },
  { value: 'FACULTY',  label: 'Faculty',  icon: '👨‍🏫', desc: 'Book and approve requests' },
  { value: 'ADMIN',    label: 'Admin',    icon: '🛡️', desc: 'Full system access' },
  { value: 'IT_STAFF', label: 'IT Staff', icon: '⚙️', desc: 'Manage infrastructure' },
];

const DEPARTMENTS = [
  'CSE', 'CSD', 'ECE', 'ECD', 'CLD', 'CND', 'CSAM', 'Civil', 'Mtech', 'PhD', 'Others',
];

interface Props {
  onSwitchToLogin: () => void;
}

export function SignupPage({ onSwitchToLogin }: Props) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'STUDENT',
    department: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await authService.signup(form);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="login-root">
        <div className="login-bg">
          <div className="blob blob-1" /><div className="blob blob-2" />
          <div className="grid-overlay" />
        </div>
        <div className="login-card success-card">
          <div className="success-icon">✅</div>
          <h2 className="success-title">Account Created!</h2>
          <p className="success-msg">Your UniBook account has been set up successfully. You can now sign in.</p>
          <button className="login-btn" onClick={onSwitchToLogin}>Go to Login →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-root">
      <div className="login-bg">
        <div className="blob blob-1" /><div className="blob blob-2" />
        <div className="grid-overlay" />
      </div>

      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <svg width="40" height="40" viewBox="0 0 36 36" fill="none">
              <rect width="36" height="36" rx="10" fill="url(#lg2)" />
              <path d="M9 27V13l9-4 9 4v14l-9 4-9-4Z" fill="white" opacity="0.15" />
              <path d="M18 9l9 4v14l-9 4" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M18 9l-9 4v14l9 4" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M9 13l9 4 9-4" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M18 17v10" stroke="white" strokeWidth="2" />
              <defs>
                <linearGradient id="lg2" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="login-title">Create Account</h1>
          <p className="login-subtitle">Join UniBook — University Resource Booking</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {/* Full Name */}
          <div className="field-group">
            <label htmlFor="name" className="field-label">Full Name</label>
            <div className="field-wrap">
              <svg className="field-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              <input id="name" name="name" type="text" className="field-input"
                placeholder="Jane Smith" onChange={handleChange} required disabled={loading} />
            </div>
          </div>

          {/* Email */}
          <div className="field-group">
            <label htmlFor="signup-email" className="field-label">University Email</label>
            <div className="field-wrap">
              <svg className="field-icon" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
              </svg>
              <input id="signup-email" name="email" type="email" className="field-input"
                placeholder="you@university.edu" onChange={handleChange} required disabled={loading} />
            </div>
          </div>

          {/* Password */}
          <div className="field-group">
            <label htmlFor="signup-password" className="field-label">Password</label>
            <div className="field-wrap">
              <svg className="field-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <input id="signup-password" name="password" type={showPass ? 'text' : 'password'}
                className="field-input" placeholder="Min. 8 characters"
                onChange={handleChange} required disabled={loading} />
              <button type="button" className="field-toggle"
                onClick={() => setShowPass((v) => !v)} aria-label="Toggle password">
                {showPass
                  ? <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" /><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" /></svg>
                  : <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                }
              </button>
            </div>
          </div>

          {/* Role */}
          <div className="field-group">
            <label className="field-label">Role</label>
            <div className="role-grid">
              {ROLES.map((r) => (
                <label
                  key={r.value}
                  className={`role-option ${form.role === r.value ? 'selected' : ''}`}
                >
                  <input type="radio" name="role" value={r.value}
                    checked={form.role === r.value} onChange={handleChange} hidden />
                  <span className="role-icon">{r.icon}</span>
                  <span className="role-label">{r.label}</span>
                  <span className="role-desc">{r.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Department */}
          <div className="field-group">
            <label htmlFor="department" className="field-label">Department <span className="optional">(optional)</span></label>
            <div className="field-wrap">
              <svg className="field-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
              </svg>
              <select
                id="department"
                name="department"
                className="field-input"
                value={form.department}
                onChange={handleChange}
                disabled={loading}
                style={{ cursor: 'pointer' }}
              >
                <option value="">— Select department —</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? <><span className="btn-spinner" /> Creating account…</> : <>Create Account</>}
          </button>
        </form>

        <div className="login-footer-row">
          <p className="login-footer">Secure · JWT authenticated · Role-based</p>
          <button className="switch-btn" onClick={onSwitchToLogin}>
            Already have an account →
          </button>
        </div>
      </div>
    </div>
  );
}
