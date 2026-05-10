// src/pages/AdminResourcesPage.tsx
// Subsystem 2 — Admin panel for resource management.
// Roles: ADMIN can create resources + schedule maintenance.
//        IT_STAFF can schedule maintenance only.
//
// Connects to Resource Catalogue backend (port 3003):
//   POST /resources          — create resource (ADMIN only)
//   PUT  /resources/:id/maintenance — schedule maintenance (ADMIN + IT_STAFF)
//   GET  /health             — Resource Catalogue health

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { resourceService } from '../services/resourceService';
import type { Resource, ResourceTypeId } from '../types/resource';
import { RESOURCE_TYPE_META } from '../types/resource';

interface Props {
  onBack: () => void;
  onViewResource: (r: Resource) => void;
}

type AdminTab = 'resources' | 'create' | 'maintenance' | 'health';

const TYPE_OPTIONS: { id: ResourceTypeId; label: string }[] = [
  { id: 'SEMINAR_ROOM', label: 'Seminar Room' },
  { id: 'LAB',          label: 'Laboratory'   },
  { id: 'GPU_CLUSTER',  label: 'GPU Cluster'  },
  { id: 'EQUIPMENT',    label: 'Equipment'    },
];

export function AdminResourcesPage({ onBack, onViewResource }: Props) {
  const { accessToken, user } = useAuth();
  const isAdmin   = user?.role === 'ADMIN';
  const isITStaff = user?.role === 'IT_STAFF' || user?.role === 'ADMIN';

  const [tab,       setTab]       = useState<AdminTab>('resources');
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // Create form
  const [createForm, setCreateForm] = useState({
    name: '', typeId: 'SEMINAR_ROOM' as ResourceTypeId,
    location: '', capacity: '1', description: '', amenities: '',
  });
  const [creating,     setCreating]     = useState(false);
  const [createError,  setCreateError]  = useState<string | null>(null);
  const [createSuccess,setCreateSuccess]= useState<string | null>(null);

  // Maintenance form
  const [maintForm, setMaintForm] = useState({
    resourceId: '', startTime: '', endTime: '', reason: '',
  });
  const [scheduling,    setScheduling]    = useState(false);
  const [maintError,    setMaintError]    = useState<string | null>(null);
  const [maintSuccess,  setMaintSuccess]  = useState<string | null>(null);

  // Health
  const [health, setHealth] = useState<{ status: string; redis: string; cache?: { availabilityKeys: number } } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadResources = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await resourceService.searchResources({}, accessToken);
      setResources(result.resources);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load resources');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const h = await resourceService.health();
      setHealth(h);
    } catch {
      setHealth({ status: 'offline', redis: 'unknown' });
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'resources' || tab === 'maintenance') loadResources();
    if (tab === 'health') loadHealth();
  }, [tab, loadResources, loadHealth]);

  // ── Create resource ──────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    const amenities = createForm.amenities
      .split(',').map((a) => a.trim()).filter(Boolean);

    try {
      const resource = await resourceService.createResource(
        {
          name:        createForm.name.trim(),
          typeId:      createForm.typeId,
          location:    createForm.location.trim(),
          capacity:    parseInt(createForm.capacity, 10),
          description: createForm.description.trim(),
          amenities,
        },
        accessToken,
      );
      setCreateSuccess(` Resource "${resource.name}" created with ID: ${resource.id}`);
      setCreateForm({ name: '', typeId: 'SEMINAR_ROOM', location: '', capacity: '1', description: '', amenities: '' });
      loadResources();
    } catch (e: unknown) {
      setCreateError((e as Error).message || 'Failed to create resource');
    } finally {
      setCreating(false);
    }
  };

  // ── Schedule maintenance ─────────────────────────────────────────────────
  const handleMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !maintForm.resourceId) return;
    setScheduling(true);
    setMaintError(null);
    setMaintSuccess(null);

    try {
      await resourceService.scheduleMaintenance(
        maintForm.resourceId,
        {
          startTime: new Date(maintForm.startTime).toISOString(),
          endTime:   new Date(maintForm.endTime).toISOString(),
          reason:    maintForm.reason,
        },
        accessToken,
      );
      setMaintSuccess(' Maintenance window scheduled. Cache invalidated automatically.');
      setMaintForm({ resourceId: '', startTime: '', endTime: '', reason: '' });
    } catch (e: unknown) {
      setMaintError((e as Error).message || 'Failed to schedule maintenance');
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className="booking-page">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="booking-page-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div>
          <h1 className="booking-page-title">⚙️ Resource Admin Panel</h1>
          <p className="booking-page-sub">Manage the university resource catalogue (Subsystem 2)</p>
        </div>
        <span className="rb-admin-role-badge">
          {isAdmin ? '🛡️ Admin' : isITStaff ? '⚙️ IT Staff' : '👤 User'}
        </span>
      </div>

      {/* ── Tab nav ──────────────────────────────────────────────────── */}
      <div className="filter-bar" style={{ marginBottom: '1.5rem' }}>
        <button
          className={`filter-pill ${tab === 'resources' ? 'active' : ''}`}
          onClick={() => setTab('resources')}
        >🏢 All Resources</button>
        {isAdmin && (
          <button
            className={`filter-pill ${tab === 'create' ? 'active' : ''}`}
            onClick={() => setTab('create')}
          >➕ Create Resource</button>
        )}
        <button
          className={`filter-pill ${tab === 'maintenance' ? 'active' : ''}`}
          onClick={() => setTab('maintenance')}
        >🔧 Maintenance</button>
        <button
          className={`filter-pill ${tab === 'health' ? 'active' : ''}`}
          onClick={() => setTab('health')}
        >💚 Catalogue Health</button>
      </div>

      {/* ── All Resources Tab ─────────────────────────────────────────── */}
      {tab === 'resources' && (
        <div className="subsystem-card">
          <div className="audit-header">
            <h2 className="section-title">All Resources ({resources.length})</h2>
            <button className="refresh-btn" onClick={loadResources} disabled={loading}>
              {loading ? <span className="btn-spinner small" /> : '↻ Refresh'}
            </button>
          </div>
          {error && <p style={{ color: '#f87171', marginBottom: 16 }}>⚠ {error}</p>}
          {loading ? (
            <div className="audit-loading"><div className="ub-spinner" /></div>
          ) : (
            <div className="admin-resource-table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Type</th><th>Location</th>
                    <th>Capacity</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {resources.map((r) => {
                    const meta = RESOURCE_TYPE_META[r.typeId];
                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                        <td>
                          <span style={{ color: meta.color, background: meta.bg, padding: '2px 8px', borderRadius: 6, fontSize: '0.78rem' }}>
                            {meta.icon} {meta.label}
                          </span>
                        </td>
                        <td>{r.location}</td>
                        <td>{r.capacity}</td>
                        <td>
                          <span className={`component-status ${r.isActive ? 'online' : 'scheduled'}`}>
                            {r.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="refresh-btn"
                            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                            onClick={() => onViewResource(r)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {resources.length === 0 && !loading && (
                <p className="audit-empty">No resources found.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Create Resource Tab ───────────────────────────────────────── */}
      {tab === 'create' && isAdmin && (
        <div className="subsystem-card">
          <h2 className="section-title">➕ Create New Resource</h2>
          <form className="admin-form" onSubmit={handleCreate}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Name <span className="required">*</span></label>
                <input className="form-input" placeholder="e.g. Seminar Room D101"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                  required />
              </div>
              <div className="form-group">
                <label className="form-label">Type <span className="required">*</span></label>
                <select className="form-input"
                  value={createForm.typeId}
                  onChange={(e) => setCreateForm((p) => ({ ...p, typeId: e.target.value as ResourceTypeId }))}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Location <span className="required">*</span></label>
                <input className="form-input" placeholder="e.g. Block D, Floor 1"
                  value={createForm.location}
                  onChange={(e) => setCreateForm((p) => ({ ...p, location: e.target.value }))}
                  required />
              </div>
              <div className="form-group">
                <label className="form-label">Capacity <span className="required">*</span></label>
                <input className="form-input" type="number" min={1}
                  value={createForm.capacity}
                  onChange={(e) => setCreateForm((p) => ({ ...p, capacity: e.target.value }))}
                  required />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" placeholder="Short description of the resource"
                value={createForm.description}
                onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))} />
            </div>

            <div className="form-group">
              <label className="form-label">Amenities <span className="form-hint">(comma-separated: projector, whiteboard, ac)</span></label>
              <input className="form-input" placeholder="projector, whiteboard, ac"
                value={createForm.amenities}
                onChange={(e) => setCreateForm((p) => ({ ...p, amenities: e.target.value }))} />
            </div>

            {createError && (
              <div className="form-error"><p>{createError}</p></div>
            )}
            {createSuccess && (
              <div className="form-success"><p>{createSuccess}</p></div>
            )}

            <button className="submit-btn" type="submit" disabled={creating}>
              {creating ? <><span className="btn-spinner small" /> Creating…</> : '➕ Create Resource'}
            </button>
          </form>
        </div>
      )}

      {/* ── Maintenance Tab ───────────────────────────────────────────── */}
      {tab === 'maintenance' && (
        <div className="subsystem-card">
          <h2 className="section-title">🔧 Schedule Maintenance Window</h2>
          <p className="card-desc" style={{ marginBottom: 20 }}>
            Maintenance windows block a resource from being booked. The availability cache is automatically invalidated when you save.
          </p>
          <form className="admin-form" onSubmit={handleMaintenance}>
            <div className="form-group">
              <label className="form-label">Resource <span className="required">*</span></label>
              {loading ? (
                <p className="form-hint">Loading resources…</p>
              ) : (
                <select className="form-input"
                  value={maintForm.resourceId}
                  onChange={(e) => setMaintForm((p) => ({ ...p, resourceId: e.target.value }))}
                  required
                >
                  <option value="">— Select a resource —</option>
                  {resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.location})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Time <span className="required">*</span></label>
                <input className="form-input" type="datetime-local"
                  value={maintForm.startTime}
                  onChange={(e) => setMaintForm((p) => ({ ...p, startTime: e.target.value }))}
                  required />
              </div>
              <div className="form-group">
                <label className="form-label">End Time <span className="required">*</span></label>
                <input className="form-input" type="datetime-local"
                  value={maintForm.endTime}
                  onChange={(e) => setMaintForm((p) => ({ ...p, endTime: e.target.value }))}
                  required />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Reason</label>
              <input className="form-input" placeholder="e.g. Scheduled network upgrade"
                value={maintForm.reason}
                onChange={(e) => setMaintForm((p) => ({ ...p, reason: e.target.value }))} />
            </div>

            {maintError && <div className="form-error"><p>{maintError}</p></div>}
            {maintSuccess && <div className="form-success"><p>{maintSuccess}</p></div>}

            <button className="submit-btn" type="submit" disabled={scheduling}>
              {scheduling ? <><span className="btn-spinner small" /> Scheduling…</> : '🔧 Schedule Maintenance'}
            </button>
          </form>
        </div>
      )}

      {/* ── Health Tab ────────────────────────────────────────────────── */}
      {tab === 'health' && (
        <div className="subsystem-card">
          <div className="audit-header">
            <h2 className="section-title"> Resource Catalogue — System Health</h2>
            <button className="refresh-btn" onClick={loadHealth} disabled={healthLoading}>
              {healthLoading ? <span className="btn-spinner small" /> : '↻ Refresh'}
            </button>
          </div>

          {healthLoading ? (
            <div className="audit-loading"><div className="ub-spinner" /></div>
          ) : health ? (
            <div className="component-grid" style={{ marginTop: 16 }}>
              <div className="component-item">
                <div className="component-header">
                  <span className="component-name">Service Status</span>
                  <span className={`component-status ${health.status === 'ok' ? 'online' : 'scheduled'}`}>
                    {health.status === 'ok' ? 'Online' : 'Offline'}
                  </span>
                </div>
                <p className="component-note">Resource Catalogue · port 3003</p>
              </div>
              <div className="component-item">
                <div className="component-header">
                  <span className="component-name">Redis Cache</span>
                  <span className={`component-status ${health.redis === 'connected' ? 'online' : 'scheduled'}`}>
                    {health.redis === 'connected' ? 'Connected' : health.redis}
                  </span>
                </div>
                <p className="component-note">30s TTL · write-invalidate on booking events</p>
              </div>
              <div className="component-item">
                <div className="component-header">
                  <span className="component-name">Availability Cache Keys</span>
                  <span className="component-status online">{health.cache?.availabilityKeys ?? '—'}</span>
                </div>
                <p className="component-note">Active cached availability windows in Redis</p>
              </div>
              <div className="component-item">
                <div className="component-header">
                  <span className="component-name">AvailabilityCacheManager</span>
                  <span className="component-status online">Online</span>
                </div>
                <p className="component-note">Proxy + Template Method · read-through cache</p>
              </div>
              <div className="component-item">
                <div className="component-header">
                  <span className="component-name">ResourceSearchEngine</span>
                  <span className="component-status online">Online</span>
                </div>
                <p className="component-note">Specification pattern · composable filters</p>
              </div>
              <div className="component-item">
                <div className="component-header">
                  <span className="component-name">BookingEventListener</span>
                  <span className="component-status online">Online</span>
                </div>
                <p className="component-note">Observer pattern · cache invalidation webhook</p>
              </div>
            </div>
          ) : (
            <p className="audit-empty">Could not reach Resource Catalogue backend on port 3003.</p>
          )}
        </div>
      )}
    </div>
  );
}