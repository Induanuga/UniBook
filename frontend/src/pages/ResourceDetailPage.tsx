// src/pages/ResourceDetailPage.tsx
// Subsystem 2 — Resource Catalogue: Resource Detail + Live Availability Calendar.
//
// Features:
//   • Resource metadata panel (name, type, location, capacity, amenities)
//   • Date picker → live 96-slot 15-min availability calendar (FR-1)
//   • Slot status colour coding: FREE / BOOKED / PENDING / MAINTENANCE
//   • Click any free slot → pre-fills NewBookingPage start time
//   • Shows fromCache indicator (Tactic 2 observability)
//   • "Book this Resource" button → connects to Booking Engine (Subsystem 3)

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { resourceService } from '../services/resourceService';
import type { Resource, TimeSlot, AvailabilityCalendar } from '../types/resource';
import { RESOURCE_TYPE_META } from '../types/resource';

interface Props {
  resource:    Resource;
  onBack:      () => void;
  onBook:      (resource: Resource, startTime?: string) => void;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

// Groups 96 15-min slots into hours for display
// Times are stored as UTC in the backend, but we display them in local timezone
function groupByHour(slots: TimeSlot[]): { hour: string; slots: TimeSlot[] }[] {
  const map = new Map<string, TimeSlot[]>();
  for (const slot of slots) {
    const d    = new Date(slot.startTime);
    // Convert UTC to local time for display
    const hour = `${String(d.getHours()).padStart(2, '0')}:00`;
    if (!map.has(hour)) map.set(hour, []);
    map.get(hour)!.push(slot);
  }
  return Array.from(map.entries()).map(([hour, slots]) => ({ hour, slots }));
}

function formatSlotTime(iso: string) {
  const d = new Date(iso);
  // Convert UTC to local time for display
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const SLOT_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  FREE:        { bg: 'rgba(52,211,153,0.18)',  color: '#34d399', label: 'Free' },
  BOOKED:      { bg: 'rgba(248,113,113,0.18)', color: '#f87171', label: 'Booked' },
  PENDING:     { bg: 'rgba(245,158,11,0.18)',  color: '#f59e0b', label: 'Pending' },
  MAINTENANCE: { bg: 'rgba(107,114,128,0.18)', color: '#9ca3af', label: 'Maintenance' },
};

export function ResourceDetailPage({ resource, onBack, onBook }: Props) {
  const { accessToken } = useAuth();
  const meta = RESOURCE_TYPE_META[resource.typeId];

  const [selectedDate,  setSelectedDate]  = useState(todayDate());
  const [calendar,      setCalendar]      = useState<AvailabilityCalendar | null>(null);
  const [calLoading,    setCalLoading]    = useState(false);
  const [calError,      setCalError]      = useState<string | null>(null);
  const [selectedSlot,  setSelectedSlot]  = useState<TimeSlot | null>(null);

  const loadCalendar = useCallback(async (date: string) => {
    if (!accessToken) return;
    setCalLoading(true);
    setCalError(null);
    setSelectedSlot(null);
    try {
      const cal = await resourceService.getAvailability(resource.id, date, accessToken);
      setCalendar(cal);
    } catch (e: unknown) {
      setCalError((e as Error).message || 'Failed to load availability');
    } finally {
      setCalLoading(false);
    }
  }, [accessToken, resource.id]);

  useEffect(() => { loadCalendar(selectedDate); }, [loadCalendar, selectedDate]);

  const freeCount = calendar?.slots.filter((s) => s.status === 'FREE').length ?? 0;
  const hours     = calendar ? groupByHour(calendar.slots) : [];

  const handleSlotClick = (slot: TimeSlot) => {
    if (slot.status !== 'FREE') return;
    setSelectedSlot(slot);
  };

  const handleBookSelected = () => {
    onBook(resource, selectedSlot?.startTime);
  };

  return (
    <div className="rd-root">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="rd-page-header">
        <button className="back-btn" onClick={onBack}>← Back to Resources</button>
        <button className="rb-book-btn large" onClick={() => onBook(resource)}>
          📅 Book this Resource
        </button>
      </div>

      <div className="rd-layout">
        {/* ── Resource info panel ─────────────────────────────────────── */}
        <aside className="rd-info-panel">
          <div className="rd-resource-badge" style={{ background: meta.bg, color: meta.color }}>
            <span className="rd-resource-icon">{meta.icon}</span>
            <span className="rd-resource-type-label">{meta.label}</span>
          </div>

          <h1 className="rd-resource-name">{resource.name}</h1>

          {resource.description && (
            <p className="rd-resource-desc">{resource.description}</p>
          )}

          <div className="rd-meta-list">
            <div className="rd-meta-item">
              <span className="rd-meta-icon">📍</span>
              <div>
                <p className="rd-meta-label">Location</p>
                <p className="rd-meta-value">{resource.location}</p>
              </div>
            </div>
            <div className="rd-meta-item">
              <span className="rd-meta-icon">👥</span>
              <div>
                <p className="rd-meta-label">Capacity</p>
                <p className="rd-meta-value">{resource.capacity} people</p>
              </div>
            </div>
            <div className="rd-meta-item">
              <span className="rd-meta-icon">🟢</span>
              <div>
                <p className="rd-meta-label">Status</p>
                <p className="rd-meta-value" style={{ color: resource.isActive ? '#34d399' : '#f87171' }}>
                  {resource.isActive ? 'Available for booking' : 'Inactive'}
                </p>
              </div>
            </div>
          </div>

          {resource.amenities.length > 0 && (
            <div className="rd-amenities-section">
              <p className="rd-amenities-label">Amenities</p>
              <div className="rd-amenities-grid">
                {resource.amenities.map((a) => (
                  <span key={a} className="rd-amenity-tag">{a}</span>
                ))}
              </div>
            </div>
          )}

          {/* Quick book button if a slot is selected */}
          {selectedSlot && (
            <div className="rd-selected-slot-panel">
              <p className="rd-selected-label">Selected slot</p>
              <p className="rd-selected-time">
                {formatSlotTime(selectedSlot.startTime)} — {formatSlotTime(selectedSlot.endTime)}
              </p>
              <p className="rd-selected-date">{selectedDate}</p>
              <button className="rb-book-btn full-width" onClick={handleBookSelected}>
                📅 Book this slot
              </button>
            </div>
          )}

          <div className="rd-resource-id-box">
            <p className="rd-meta-label">Resource ID</p>
            <p className="rd-id-text">{resource.id}</p>
          </div>
        </aside>

        {/* ── Availability Calendar ────────────────────────────────────── */}
        <section className="rd-calendar-section">
          <div className="rd-calendar-header">
            <div>
              <h2 className="rd-calendar-title">Live Availability</h2>
              <p className="rd-calendar-sub">15-minute slot granularity · Updated in real-time</p>
            </div>
            <div className="rd-calendar-controls">
              <input
                className="rb-input"
                type="date"
                value={selectedDate}
                min={todayDate()}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
              <button className="rb-retry-btn" onClick={() => loadCalendar(selectedDate)}>
                ↺
              </button>
            </div>
          </div>

          {/* Cache indicator — Tactic 2 observability */}
          {calendar && (
            <div className="rd-cache-badge">
              {calendar.fromCache
                ? '⚡ Served from Redis cache'
                : '🗄️ Fetched from database'}
              <span className="rd-cache-time">
                · Computed at {new Date(calendar.cachedAt).toLocaleTimeString()}
              </span>
            </div>
          )}

          {/* Legend */}
          <div className="rd-legend">
            {Object.entries(SLOT_STYLE).map(([status, style]) => (
              <div key={status} className="rd-legend-item">
                <span className="rd-legend-dot" style={{ background: style.color }} />
                <span>{style.label}</span>
              </div>
            ))}
            <span className="rd-legend-hint">Click a free slot to pre-fill booking</span>
          </div>

          {/* Availability summary */}
          {calendar && !calLoading && (
            <div className={`rd-avail-summary ${freeCount > 0 ? 'good' : 'none'}`}>
              {freeCount > 0
                ? `✅ ${freeCount} free slot${freeCount !== 1 ? 's' : ''} available on ${selectedDate}`
                : `❌ No free slots on ${selectedDate}`}
            </div>
          )}

          {/* Loading state */}
          {calLoading && (
            <div className="rd-cal-state">
              <div className="rb-spinner-ring" />
              <p>Loading availability…</p>
            </div>
          )}

          {/* Error state */}
          {!calLoading && calError && (
            <div className="rd-cal-state rd-cal-error">
              <span>⚠️ {calError}</span>
              <button className="rb-retry-btn" onClick={() => loadCalendar(selectedDate)}>Retry</button>
            </div>
          )}

          {/* Calendar grid — hour rows × 4 quarter-hour slots */}
          {!calLoading && !calError && calendar && (
            <div className="rd-cal-grid">
              {hours.map(({ hour, slots: hourSlots }) => {
                const hasFreeSlotsInHour = hourSlots.some((s) => s.status === 'FREE');
                return (
                  <div key={hour} className="rd-hour-row">
                    <div className="rd-hour-label">{hour}</div>
                    <div className="rd-hour-slots">
                      {hourSlots.map((slot) => {
                        const style = SLOT_STYLE[slot.status];
                        const isSelected = selectedSlot?.startTime === slot.startTime;
                        return (
                          <button
                            key={slot.startTime}
                            className={`rd-slot ${slot.status.toLowerCase()} ${isSelected ? 'selected' : ''}`}
                            style={{
                              background: isSelected ? style.color : style.bg,
                              color:      isSelected ? '#0f1117' : style.color,
                              borderColor: isSelected ? style.color : 'transparent',
                            }}
                            onClick={() => handleSlotClick(slot)}
                            disabled={slot.status !== 'FREE'}
                            title={`${formatSlotTime(slot.startTime)}–${formatSlotTime(slot.endTime)} · ${style.label}`}
                          >
                            {formatSlotTime(slot.startTime)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}