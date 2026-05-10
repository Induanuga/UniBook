// src/services/approvalService.ts
// API calls to the Approval Workflow (Subsystem 4, port 3004).

const APPROVAL_API = import.meta.env.VITE_APPROVAL_API_URL || 'http://localhost:3004';

async function approvalFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res  = await fetch(`${APPROVAL_API}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = new Error(data.error || data.message || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body   = data;
    throw err;
  }
  return data as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | 'AWAITING_FACULTY'
  | 'AWAITING_ADMIN'
  | 'APPROVED'
  | 'REJECTED'
  | 'ALTERNATIVE_SUGGESTED';

export type DecisionType = 'APPROVE' | 'REJECT' | 'SUGGEST_ALTERNATIVE';

export type ApprovalRequest = {
  id:               string;
  bookingId:        string;
  resourceId:       string;
  requesterId:      string;
  requesterEmail:   string;
  requesterRole:    string;
  requesterName:    string;
  department:       string;
  startTime:        string;
  endTime:          string;
  purpose:          string;
  resourceName?:    string;
  status:           ApprovalStatus;
  currentLevel:     'FACULTY' | 'ADMIN';
  decidedByEmail?:  string;
  decisionReason?:  string;
  alternativeSlot?: { startTime: string; endTime: string };
  escalatedAt?:     string;
  decidedAt?:       string;
  createdAt:        string;
  updatedAt:        string;
};

export type DecisionPayload = {
  decision:          DecisionType;
  reason?:           string;
  alternativeStart?: string;
  alternativeEnd?:   string;
};

// ── API client ────────────────────────────────────────────────────────────────

export const approvalService = {
  /**
   * Get all pending approvals assigned to the current user (FACULTY / ADMIN).
   */
  getPendingApprovals: (token: string): Promise<{ approvals: ApprovalRequest[] }> =>
    approvalFetch('/approvals/pending', {}, token),

  /**
   * Get all approval requests I submitted (as requester).
   */
  getMyApprovals: (token: string): Promise<{ approvals: ApprovalRequest[] }> =>
    approvalFetch('/approvals/my', {}, token),

  /**
   * Get approval status for a specific booking.
   */
  getApprovalForBooking: (bookingId: string, token: string): Promise<{ approval: ApprovalRequest }> =>
    approvalFetch(`/approvals/booking/${bookingId}`, {}, token),

  /**
   * Get a single approval request by approval ID.
   */
  getApproval: (approvalId: string, token: string): Promise<{ approval: ApprovalRequest }> =>
    approvalFetch(`/approvals/${approvalId}`, {}, token),

  /**
   * Submit a decision (APPROVE / REJECT / SUGGEST_ALTERNATIVE) for an approval.
   */
  decide: (
    approvalId: string,
    payload: DecisionPayload,
    token: string,
  ): Promise<{ approval: ApprovalRequest; message: string }> =>
    approvalFetch(`/approvals/${approvalId}/decide`, {
      method: 'POST',
      body:   JSON.stringify(payload),
    }, token),

  /** Health check */
  health: (): Promise<{ status: string }> =>
    approvalFetch('/health'),
};
