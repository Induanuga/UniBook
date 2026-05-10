// src/pages/NewBookingPage.tsx
// UPDATED for Subsystem 2 integration:
//   - Accepts preselectedResource (from ResourceBrowserPage / ResourceDetailPage)
//   - Accepts preselectedStartTime (from slot click on availability calendar)
//   - Shows resource picker banner when resource is pre-selected
//   - "Browse Resources" button opens ResourceBrowserPage from within this page
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { bookingService } from '../services/bookingService';
import type { SlotSuggestion, Booking } from '../services/bookingService';
import type { Resource } from '../types/resource';
import { RESOURCE_TYPE_META } from '../types/resource';

interface Props {
  onBack:                () => void;
  onSuccess:             (booking: Booking) => void;
  preselectedResource?:  Resource;
  preselectedStartTime?: string;
  onBrowseResources?:    () => void;
}

export function toLocalDateTimeInput(iso?: string) {
  if (!iso) return '';
  const d   = new Date(iso);
  // Convert UTC to local time for input field
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toISO(localDT: string) {
  return new Date(localDT).toISOString();
}

// Auto-compute end time: start + 1 hour
function addOneHour(localDT: string): string {
  if (!localDT) return '';
  const d = new Date(localDT);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewBookingPage({ onBack, onSuccess, preselectedResource, preselectedStartTime, onBrowseResources }: Props) {
  const { accessToken } = useAuth();

  const [form, setForm] = useState({
    resourceId:    preselectedResource?.id ?? '',
    startTime:     preselectedStartTime ? toLocalDateTimeInput(preselectedStartTime) : '',
    endTime:       preselectedStartTime ? addOneHour(toLocalDateTimeInput(preselectedStartTime)) : '',
    purpose:       '',
    attendeeCount: '1',
  });

  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SlotSuggestion[]>([]);
  const [success, setSuccess]         = useState<Booking | null>(null);

  // Re-apply if preselected values change (navigating back here from calendar)
  useEffect(() => {
    if (preselectedResource) {
      setForm((prev) => ({ ...prev, resourceId: preselectedResource.id }));
    }
    if (preselectedStartTime) {
      const start = toLocalDateTimeInput(preselectedStartTime);
      setForm((prev) => ({
        ...prev,
        startTime: start,
        endTime:   addOneHour(start),
      }));
    }
  }, [preselectedResource, preselectedStartTime]);

  const set = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }));
    setError(null);
    setSuggestions([]);
  };

  const applySuggestion = (s: SlotSuggestion) => {
    setForm(prev => ({
      ...prev,
      startTime: toLocalDateTimeInput(s.startTime),
      endTime:   toLocalDateTimeInput(s.endTime),
    }));
    setSuggestions([]);
    setError(null);
  };

  const validate = () => {
    if (!form.resourceId.trim()) return 'Resource is required. Browse to select one.';
    if (!form.startTime)         return 'Start time is required.';
    if (!form.endTime)           return 'End time is required.';
    if (new Date(form.startTime) >= new Date(form.endTime))
      return 'End time must be after start time.';
    if (!form.purpose.trim())    return 'Purpose is required.';
    if (form.purpose.length > 500) return 'Purpose must be 500 characters or less.';
    const count = parseInt(form.attendeeCount, 10);
    if (isNaN(count) || count < 1) return 'Attendee count must be at least 1.';
    // Capacity validation (if resource is pre-selected)
    if (preselectedResource && count > preselectedResource.capacity) {
      return `Resource capacity is ${preselectedResource.capacity} but you requested ${count} attendees.`;
    }
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    if (!accessToken) { setError('Not authenticated.'); return; }

    setSubmitting(true);
    setError(null);
    setSuggestions([]);

    try {
      const res = await bookingService.submitBooking(
        {
          resourceId:    form.resourceId.trim(),
          startTime:     toISO(form.startTime),
          endTime:       toISO(form.endTime),
          purpose:       form.purpose.trim(),
          attendeeCount: parseInt(form.attendeeCount, 10),
        },
        accessToken,
      );
      setSuccess(res.booking);
      onSuccess(res.booking);
    } catch (e: unknown) {
      const err = e as { status?: number; body?: { suggestions?: SlotSuggestion[] }; message?: string };
      if (err.status === 409 && err.body?.suggestions) {
        setError('That slot is already booked. Here are the next available slots:');
        setSuggestions(err.body.suggestions);
      } else {
        setError(err.message || 'Submission failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="booking-page">
        <div className="booking-success-screen">
          <div className="success-icon">🎉</div>
          <h2>Booking Submitted!</h2>
          <p>Your booking is <strong>pending approval</strong>. You'll be notified once it's reviewed.</p>
          <div className="success-details">
            {preselectedResource && (
              <div className="success-row">
                <span>Resource</span>
                <span>{preselectedResource.name}</span>
              </div>
            )}
            <div className="success-row"><span>Resource ID</span><span className="mono" style={{ fontSize: '0.78rem' }}>{success.resourceId}</span></div>
            <div className="success-row">
              <span>From</span>
              <span>{new Date(success.startTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
            <div className="success-row">
              <span>To</span>
              <span>{new Date(success.endTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
            <div className="success-row"><span>Status</span><span style={{ color: '#f59e0b' }}>Pending</span></div>
            <div className="success-row mono" style={{ fontSize: '0.75rem', opacity: 0.5 }}>
              <span>Booking ID</span><span>{success.id}</span>
            </div>
          </div>
          <div className="success-actions">
            <button className="new-booking-btn" onClick={onBack}>Back to Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="booking-page">
      <div className="booking-page-header">
        <button className="back-btn" onClick={onBack}>Back</button>
        <div>
          <h1 className="booking-page-title">New Booking</h1>
          <p className="booking-page-sub">Reserve a room, lab, or equipment</p>
        </div>
      </div>

      <div className="booking-form-wrap">
        <form className="booking-form" onSubmit={submit} noValidate>

          {/* ── Resource selector (Subsystem 2 integration) ───────────────── */}
          <div className="form-group">
            <label className="form-label">
              Resource <span className="required">*</span>
            </label>

            {preselectedResource ? (
              /* Resource selected from browse — show card instead of raw input */
              <div className="nb-resource-selected">
                {(() => {
                  const meta = RESOURCE_TYPE_META[preselectedResource.typeId];
                  return (
                    <>
                      <div className="nb-resource-badge" style={{ background: meta.bg, color: meta.color }}>
                        {meta.icon}
                      </div>
                      <div className="nb-resource-info">
                        <span className="nb-resource-name">{preselectedResource.name}</span>
                        <span className="nb-resource-meta">{meta.label} · {preselectedResource.location} · Capacity {preselectedResource.capacity}</span>
                      </div>
                    </>
                  );
                })()}
                {onBrowseResources && (
                  <button
                    type="button"
                    className="nb-change-btn"
                    onClick={onBrowseResources}
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              /* No resource pre-selected — show Browse button + fallback text input */
              <div className="nb-resource-picker">
                {onBrowseResources && (
                  <button
                    type="button"
                    className="nb-browse-btn"
                    onClick={onBrowseResources}
                  >
                    🔍 Browse & Select a Resource
                  </button>
                )}
                <p className="nb-or-divider">— or enter Resource ID manually —</p>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. a0000000-0000-0000-0000-000000000001"
                  value={form.resourceId}
                  onChange={set('resourceId')}
                  disabled={submitting}
                />
                <p className="form-hint">
                  Use Browse Resources (above) to find and select a resource with live availability.
                </p>
              </div>
            )}
          </div>

          {/* ── Time range ────────────────────────────────────────────────── */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="startTime">
                Start Time <span className="required">*</span>
              </label>
              <input
                id="startTime"
                className="form-input"
                type="datetime-local"
                value={form.startTime}
                onChange={set('startTime')}
                disabled={submitting}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="endTime">
                End Time <span className="required">*</span>
              </label>
              <input
                id="endTime"
                className="form-input"
                type="datetime-local"
                value={form.endTime}
                onChange={set('endTime')}
                disabled={submitting}
              />
            </div>
          </div>

          {/* ── Purpose ───────────────────────────────────────────────────── */}
          <div className="form-group">
            <label className="form-label" htmlFor="purpose">
              Purpose <span className="required">*</span>
            </label>
            <textarea
              id="purpose"
              className="form-input form-textarea"
              placeholder="e.g. Weekly team standup, ML research session..."
              value={form.purpose}
              onChange={set('purpose')}
              disabled={submitting}
              maxLength={500}
              rows={3}
            />
            <p className="form-hint">{form.purpose.length}/500 characters</p>
          </div>

          {/* ── Attendee count ─────────────────────────────────────────────── */}
          <div className="form-group" style={{ maxWidth: 200 }}>
            <label className="form-label" htmlFor="attendeeCount">
              Attendee Count <span className="required">*</span>
            </label>
            <input
              id="attendeeCount"
              className="form-input"
              type="number"
              min={1}
              max={preselectedResource?.capacity ?? 500}
              value={form.attendeeCount}
              onChange={set('attendeeCount')}
              disabled={submitting}
            />
            {preselectedResource && (
              <p className="form-hint">Max capacity: {preselectedResource.capacity}</p>
            )}
          </div>

          {/* ── Error + slot suggestions ───────────────────────────────────── */}
          {error && (
            <div className="form-error">
              <p>{error}</p>
              {suggestions.length > 0 && (
                <div className="suggestions">
                  <p className="suggestions-label">Click a slot to use it:</p>
                  <div className="suggestions-list">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        className="suggestion-pill"
                        onClick={() => applySuggestion(s)}
                      >
                        {new Date(s.startTime).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                        {' -> '}
                        {new Date(s.endTime).toLocaleTimeString('en-IN', { timeStyle: 'short' })}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <button className="submit-btn" type="submit" disabled={submitting}>
            {submitting ? <><span className="btn-spinner small" /> Submitting...</> : 'Submit Booking'}
          </button>
        </form>

        {/* ── Info panel ────────────────────────────────────────────────── */}
        <div className="booking-info-panel">
          <h3>How it works</h3>
          <div className="info-step">
            <span className="step-num">1</span>
            <div>
              <strong>Browse</strong>
              <p>Search resources by type, location, and capacity. Check live availability before booking.</p>
            </div>
          </div>
          <div className="info-step">
            <span className="step-num">2</span>
            <div>
              <strong>Submit</strong>
              <p>Fill in the time and purpose. Conflict detection runs instantly — zero double-bookings.</p>
            </div>
          </div>
          <div className="info-step">
            <span className="step-num">3</span>
            <div>
              <strong>Await Approval</strong>
              <p>Booking goes to the appropriate approver based on resource type and your role.</p>
            </div>
          </div>
          <div className="info-step">
            <span className="step-num">4</span>
            <div>
              <strong>Notification</strong>
              <p>You'll receive an email when your booking is approved or rejected.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}