// src/services/analyticsService.ts
// API client for Subsystem 6 — Analytics & Reporting Service (port 3006)

const ANALYTICS_API = import.meta.env.VITE_ANALYTICS_API_URL || 'http://localhost:3006';

async function analyticsFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${ANALYTICS_API}${path}`, { ...options, headers });

  // CSV export returns text, not JSON
  if (res.headers.get('content-type')?.includes('text/csv')) {
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    return (await res.text()) as unknown as T;
  }

  const data = await res.json();
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = new Error(data.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HeatmapCell {
  hour:      number;   // 0–23
  dayOfWeek: number;   // 0 = Sunday … 6 = Saturday
  count:     number;
}

export interface HeatmapResult {
  resourceId?: string;
  department?: string;
  from:        string;
  to:          string;
  cells:       HeatmapCell[];
}

export interface AnalyticsSummary {
  totalApproved:             number;
  totalCancelled:            number;
  totalSubmitted:            number;
  totalRejected:             number;
  totalAlternativeSuggested: number;
  from:                      string;
  to:                        string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const analyticsService = {
  /** Utilisation heatmap — Admin only */
  getHeatmap: (
    params: { from: string; to: string; resourceId?: string; department?: string },
    token: string,
  ): Promise<HeatmapResult> => {
    const qs = new URLSearchParams({ from: params.from, to: params.to });
    if (params.resourceId) qs.set('resourceId', params.resourceId);
    if (params.department) qs.set('department', params.department);
    return analyticsFetch(`/analytics/heatmap?${qs}`, {}, token);
  },

  /** Summary counts — Admin only */
  getSummary: (
    params: { from: string; to: string; department?: string; resourceId?: string },
    token: string,
  ): Promise<AnalyticsSummary> => {
    const qs = new URLSearchParams({ from: params.from, to: params.to });
    if (params.department) qs.set('department', params.department);
    if (params.resourceId) qs.set('resourceId', params.resourceId);
    return analyticsFetch(`/analytics/summary?${qs}`, {}, token);
  },

  /** CSV export — Admin only. Returns raw CSV string. */
  exportCsv: (
    params: { from: string; to: string; resourceId?: string; department?: string },
    token: string,
  ): Promise<string> => {
    const qs = new URLSearchParams({ from: params.from, to: params.to });
    if (params.resourceId) qs.set('resourceId', params.resourceId);
    if (params.department) qs.set('department', params.department);
    return analyticsFetch(`/analytics/export.csv?${qs}`, {}, token);
  },

  /** Health check */
  health: (): Promise<{ status: string }> =>
    analyticsFetch('/health'),
};
