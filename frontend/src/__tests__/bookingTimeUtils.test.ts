/**
 * Bug condition exploration test for the double timezone offset bug in toISO().
 *
 * Validates: Requirements 1.1, 1.2, 1.4
 *
 * This test MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT fix the code or the test when it fails.
 *
 * Bug: toISO() double-applies the timezone offset.
 * For UTC+5:30 user selecting 10:00 AM:
 *   - new Date("2025-07-15T10:00") in UTC+5:30 → internally 04:30 UTC
 *   - getTimezoneOffset() returns -330 → tzOffsetMs = -19,800,000 ms
 *   - d.getTime() + tzOffsetMs = 04:30 UTC − 5h30m = 23:00 UTC previous day
 *   - Buggy output: "2025-07-14T23:00:00.000Z" instead of "2025-07-15T04:30:00.000Z"
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { toISO } from '../pages/NewBookingPage';

describe('toISO() — bug condition exploration (Property 1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should convert "2025-07-15T10:00" to correct UTC "2025-07-15T04:30:00.000Z" in UTC+5:30', () => {
    // Mock timezone offset to -330 minutes (UTC+5:30)
    // getTimezoneOffset() returns negative values for east-of-UTC timezones
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330);

    const result = toISO('2025-07-15T10:00');

    // Correct UTC for 10:00 AM in UTC+5:30 is 04:30 UTC
    // The buggy code produces "2025-07-14T23:00:00.000Z" instead
    expect(result).toBe('2025-07-15T04:30:00.000Z');
  });
});

/**
 * Preservation property tests — baseline behavior for UTC users.
 *
 * Validates: Requirements 1.3, 2.3, 3.5, 3.6
 *
 * These tests MUST PASS on unfixed code — they confirm the baseline behavior
 * that must be preserved after the fix is applied.
 *
 * NOTE: These tests run with TZ=UTC so that Date local-time methods
 * (getFullYear, getHours, etc.) align with UTC, matching a UTC user's experience.
 */

import { toLocalDateTimeInput } from '../pages/NewBookingPage';

describe('Preservation tests — UTC user baseline (Property 2)', () => {
  let originalTZ: string | undefined;

  beforeEach(() => {
    // Force UTC timezone so Date local-time methods return UTC values,
    // simulating a user whose system clock is in UTC (offset = 0).
    originalTZ = process.env.TZ;
    process.env.TZ = 'UTC';
  });

  afterEach(() => {
    process.env.TZ = originalTZ;
    vi.restoreAllMocks();
  });

  it('toISO("2025-07-15T10:00") returns "2025-07-15T10:00:00.000Z" for UTC users (offset=0)', () => {
    // In UTC, new Date("2025-07-15T10:00") is parsed as 10:00 UTC.
    // The buggy toISO: tzOffsetMs = 0 * 60 * 1000 = 0, so utcTime = d → same result.
    // Both buggy and fixed code produce the same output for UTC users.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);

    const result = toISO('2025-07-15T10:00');

    expect(result).toBe('2025-07-15T10:00:00.000Z');
  });

  it('toLocalDateTimeInput("2025-07-15T04:30:00.000Z") returns "2025-07-15T04:30" for UTC users (offset=0)', () => {
    // toLocalDateTimeInput uses getFullYear/getMonth/etc. (local time methods).
    // In UTC, local === UTC, so the output matches the UTC time component.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);

    const result = toLocalDateTimeInput('2025-07-15T04:30:00.000Z');

    expect(result).toBe('2025-07-15T04:30');
  });

  it('round-trip: toLocalDateTimeInput(toISO("2025-07-15T10:00")) returns "2025-07-15T10:00" for UTC users', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);

    const iso = toISO('2025-07-15T10:00');
    const roundTripped = toLocalDateTimeInput(iso);

    expect(roundTripped).toBe('2025-07-15T10:00');
  });

  it('slot suggestion round-trip: UTC time → toLocalDateTimeInput → toISO → original UTC (offset=0)', () => {
    // Covers requirement 3.6: slot suggestion times must survive the display→submit round-trip
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);

    const slotUtc = '2025-07-15T09:00:00.000Z';
    const localDisplay = toLocalDateTimeInput(slotUtc);
    const backToUtc = toISO(localDisplay);

    expect(backToUtc).toBe(slotUtc);
  });
});
