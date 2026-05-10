// src/pages/ResourceBrowserPage.tsx
// Subsystem 2 — Resource Catalogue: Browse & Search page.
//
// Features:
//   • Search by type, location, capacity, amenities, date (FR-1)
//   • Live availability summary per resource when date is selected
//   • Resource cards with clickable "View / Book" actions
//   • Connects to Booking Engine: "Book Now" pre-fills NewBookingPage with resource ID
//   • Role-aware: Admin/IT Staff see an "Admin Panel" shortcut

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { resourceService } from '../services/resourceService';
import type { Resource, ResourceTypeId, ResourceSearchFilters } from '../types/resource';
import { RESOURCE_TYPE_META } from '../types/resource';

interface Props {
  onBack:        () => void;
  onViewResource: (resource: Resource) => void;
  onBookResource: (resource: Resource) => void;
  onAdminPanel?: () => void;
}

const TYPE_OPTIONS: { id: ResourceTypeId; label: string; icon: string }[] = [
  { id: 'SEMINAR_ROOM', label: 'Seminar Rooms', icon: '🏛️' },
  { id: 'LAB',          label: 'Laboratories',  icon: '🔬' },
  { id: 'GPU_CLUSTER',  label: 'GPU Clusters',  icon: '⚡' },
  { id: 'EQUIPMENT',    label: 'Equipment',      icon: '🎥' },
];

const AMENITY_CHIPS = ['projector', 'whiteboard', 'ac', 'computers', 'microphone', 'recording', 'gpu_a100'];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function ResourceBrowserPage({ onBack, onViewResource, onBookResource, onAdminPanel }: Props) {
  const { accessToken, user } = useAuth();

  const [resources,  setResources]  = useState<Resource[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [searched,   setSearched]   = useState(false);

  // Filters
  const [typeFilter,     setTypeFilter]     = useState<ResourceTypeId | ''>('');
  const [locationInput,  setLocationInput]  = useState('');
  const [capacityInput,  setCapacityInput]  = useState('');
  const [dateInput,      setDateInput]      = useState('');
  const [amenityFilter,  setAmenityFilter]  = useState<string[]>([]);

  // For debounced auto-search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canAdmin = user?.role === 'ADMIN' || user?.role === 'IT_STAFF';

  const doSearch = useCallback(async (filters: ResourceSearchFilters) => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await resourceService.searchResources(filters, accessToken);
      setResources(result.resources);
      setSearched(true);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to search resources');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  // Initial load — show everything
  useEffect(() => {
    doSearch({});
  }, [doSearch]);

  const buildFilters = (): ResourceSearchFilters => {
    const f: ResourceSearchFilters = {};
    if (typeFilter)           f.type        = typeFilter;
    if (locationInput.trim()) f.location    = locationInput.trim();
    if (capacityInput)        f.minCapacity = parseInt(capacityInput, 10);
    if (dateInput)            f.date        = dateInput;
    if (amenityFilter.length) f.amenities   = amenityFilter;
    return f;
  };

  const handleSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch(buildFilters());
  };

  // Auto-search on type / amenity toggle (immediate)
  const handleTypeToggle = (id: ResourceTypeId) => {
    const next = typeFilter === id ? '' : id;
    setTypeFilter(next);
    const f = buildFilters();
    if (next) f.type = next; else delete f.type;
    doSearch(f);
  };

  const handleAmenityToggle = (a: string) => {
    const next = amenityFilter.includes(a)
      ? amenityFilter.filter((x) => x !== a)
      : [...amenityFilter, a];
    setAmenityFilter(next);
    const f = buildFilters();
    f.amenities = next.length ? next : undefined;
    doSearch(f);
  };

  const handleReset = () => {
    setTypeFilter('');
    setLocationInput('');
    setCapacityInput('');
    setDateInput('');
    setAmenityFilter([]);
    doSearch({});
  };

  const handleDateChange = (val: string) => {
    setDateInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const f = buildFilters();
      f.date = val || undefined;
      doSearch(f);
    }, 400);
  };

  const handleLocationChange = (val: string) => {
    setLocationInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const f = buildFilters();
      f.location = val.trim() || undefined;
      doSearch(f);
    }, 400);
  };

  return (
    <div className="rb-root">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="rb-header">
        <div className="rb-header-left">
          <button className="back-btn" onClick={onBack}>← Back</button>
          <div>
            <h1 className="rb-title">🔍 Browse Resources</h1>
            <p className="rb-sub">Find and book university rooms, labs & equipment</p>
          </div>
        </div>
        {canAdmin && onAdminPanel && (
          <button className="rb-admin-btn" onClick={onAdminPanel}>
            ⚙️ Admin Panel
          </button>
        )}
      </div>

      <div className="rb-layout">
        {/* ── Filter sidebar ──────────────────────────────────────────── */}
        <aside className="rb-sidebar">
          <div className="rb-filter-section">
            <p className="rb-filter-label">Resource Type</p>
            <div className="rb-type-pills">
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  className={`rb-type-pill ${typeFilter === t.id ? 'active' : ''}`}
                  onClick={() => handleTypeToggle(t.id)}
                >
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rb-filter-section">
            <p className="rb-filter-label">Location</p>
            <input
              className="rb-input"
              placeholder="e.g. Block A, Floor 1"
              value={locationInput}
              onChange={(e) => handleLocationChange(e.target.value)}
            />
          </div>

          <div className="rb-filter-section">
            <p className="rb-filter-label">Min. Capacity</p>
            <input
              className="rb-input"
              type="number"
              min={1}
              placeholder="e.g. 20"
              value={capacityInput}
              onChange={(e) => setCapacityInput(e.target.value)}
              onBlur={handleSearch}
            />
          </div>

          <div className="rb-filter-section">
            <p className="rb-filter-label">Date <span className="rb-filter-hint">(shows free slots)</span></p>
            <input
              className="rb-input"
              type="date"
              min={todayDate()}
              value={dateInput}
              onChange={(e) => handleDateChange(e.target.value)}
            />
          </div>

          <div className="rb-filter-section">
            <p className="rb-filter-label">Amenities</p>
            <div className="rb-amenity-chips">
              {AMENITY_CHIPS.map((a) => (
                <button
                  key={a}
                  className={`rb-amenity-chip ${amenityFilter.includes(a) ? 'active' : ''}`}
                  onClick={() => handleAmenityToggle(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <button className="rb-reset-btn" onClick={handleReset}>
            ↺ Reset Filters
          </button>
        </aside>

        {/* ── Results area ────────────────────────────────────────────── */}
        <main className="rb-results">
          {/* Results header bar */}
          <div className="rb-results-bar">
            <span className="rb-count">
              {loading ? 'Searching…' : searched ? `${resources.length} resource${resources.length !== 1 ? 's' : ''} found` : ''}
            </span>
            {dateInput && !loading && (
              <span className="rb-date-badge">📅 {dateInput}</span>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="rb-state-screen">
              <div className="rb-spinner-ring" />
              <p>Searching resources…</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="rb-state-screen rb-error">
              <span className="rb-state-icon">⚠️</span>
              <p>{error}</p>
              <button className="rb-retry-btn" onClick={handleSearch}>Retry</button>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && searched && resources.length === 0 && (
            <div className="rb-state-screen">
              <span className="rb-state-icon">🏗️</span>
              <p>No resources match your filters.</p>
              <button className="rb-retry-btn" onClick={handleReset}>Clear filters</button>
            </div>
          )}

          {/* Resource cards grid */}
          {!loading && !error && resources.length > 0 && (
            <div className="rb-grid">
              {resources.map((r) => {
                const meta = RESOURCE_TYPE_META[r.typeId];
                const avail = r.availabilitySummary;
                return (
                  <div key={r.id} className="rb-card" onClick={() => onViewResource(r)}>
                    {/* Card header */}
                    <div className="rb-card-header">
                      <div className="rb-card-icon" style={{ background: meta.bg, color: meta.color }}>
                        {meta.icon}
                      </div>
                      <div className="rb-card-title-block">
                        <span className="rb-card-name">{r.name}</span>
                        <span className="rb-card-type" style={{ color: meta.color }}>{meta.label}</span>
                      </div>
                    </div>

                    {/* Info rows */}
                    <div className="rb-card-info">
                      <div className="rb-card-row">
                        <span className="rb-card-row-icon">📍</span>
                        <span>{r.location}</span>
                      </div>
                      <div className="rb-card-row">
                        <span className="rb-card-row-icon">👥</span>
                        <span>Capacity: {r.capacity}</span>
                      </div>
                    </div>

                    {/* Amenity tags */}
                    {r.amenities.length > 0 && (
                      <div className="rb-amenities">
                        {r.amenities.slice(0, 4).map((a) => (
                          <span key={a} className="rb-amenity-tag">{a}</span>
                        ))}
                        {r.amenities.length > 4 && (
                          <span className="rb-amenity-tag muted">+{r.amenities.length - 4}</span>
                        )}
                      </div>
                    )}

                    {/* Availability summary — only when date is selected */}
                    {avail && (
                      <div className={`rb-avail-bar ${avail.hasAvailability ? 'has-slots' : 'no-slots'}`}>
                        {avail.hasAvailability ? (
                          <span>🟢 {avail.freeSlots} free slots on {avail.date}</span>
                        ) : (
                          <span>🔴 No availability on {avail.date}</span>
                        )}
                      </div>
                    )}

                    {/* Card footer actions */}
                    <div className="rb-card-footer">
                      <button
                        className="rb-view-btn"
                        onClick={(e) => { e.stopPropagation(); onViewResource(r); }}
                      >
                        View Details
                      </button>
                      <button
                        className="rb-book-btn"
                        onClick={(e) => { e.stopPropagation(); onBookResource(r); }}
                        disabled={avail ? !avail.hasAvailability : false}
                      >
                        📅 Book
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}