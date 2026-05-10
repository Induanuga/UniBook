const BOOKING_API = import.meta.env.VITE_BOOKING_API_URL || 'http://localhost:3002';

async function bookingFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(`${BOOKING_API}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) { const err: any = new Error(data.error || data.message || `Request failed: ${res.status}`); err.status = res.status; err.body = data; throw err; }
  return data as T;
}

export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type Booking = {
  id: string; resourceId: string; resourceName?: string; userId: string;
  startTime: string; endTime: string; purpose: string; attendeeCount: number;
  status: BookingStatus; createdAt: string; updatedAt: string;
};

export type SlotSuggestion = { startTime: string; endTime: string; };

export type SubmitBookingPayload = {
  resourceId: string; startTime: string; endTime: string; purpose: string; attendeeCount: number;
};

export const bookingService = {
  submitBooking: (payload: SubmitBookingPayload, token: string): Promise<{ success: boolean; booking: Booking }> =>
    bookingFetch('/bookings', { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': crypto.randomUUID() } }, token),

  getMyBookings: (token: string): Promise<{ bookings: Booking[] }> =>
    bookingFetch('/bookings/mine', {}, token),

  getBooking: (id: string, token: string): Promise<Booking> =>
    bookingFetch(`/bookings/${id}`, {}, token),

  cancelBooking: (id: string, token: string): Promise<{ booking: Booking }> =>
    bookingFetch(`/bookings/${id}`, { method: 'DELETE' }, token),

  health: (): Promise<{ status: string }> =>
    bookingFetch('/health'),
};
