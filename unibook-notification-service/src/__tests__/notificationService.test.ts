// src/__tests__/notificationService.test.ts
// Unit tests for NotificationService — all DB interactions mocked.

import { NotificationService } from '../services/NotificationService';
import type { NotificationEvent } from '../types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeMockPool() {
    return {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
}

function makeEvent(
    eventType: NotificationEvent['eventType'] = 'BOOKING_APPROVED',
    overrides: Partial<NotificationEvent> = {},
): NotificationEvent {
    return {
        eventType,
        correlationId: 'corr-1',
        recipientId: 'user-1',
        recipientEmail: 'student@uni.edu',
        recipientName: 'Alice',
        bookingId: 'book-1',
        approvalId: 'appr-1',
        resourceName: 'Lab 101',
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}

function makeMockRepo(overrides: Record<string, jest.Mock> = {}): Record<string, jest.Mock> {
    return {
        findByRecipientId: overrides.findByRecipientId ?? jest.fn().mockResolvedValue([]),
        countUnread: overrides.countUnread ?? jest.fn().mockResolvedValue(0),
        markRead: overrides.markRead ?? jest.fn().mockResolvedValue(null),
        markAllRead: overrides.markAllRead ?? jest.fn().mockResolvedValue(0),
        insert: overrides.insert ?? jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };
}

afterEach(() => jest.clearAllMocks());

// ── processEvent tests ────────────────────────────────────────────────────────

describe('NotificationService.processEvent()', () => {
    test('delivers BOOKING_APPROVED via IN_APP channel', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const mockRepo = makeMockRepo();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).repo = mockRepo;

        // Mock registry to return a fake channel
        const deliverMock = jest.fn().mockResolvedValue(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).registry = {
            getChannelsFor: jest.fn().mockReturnValue([
                { channelName: 'IN_APP', deliver: deliverMock },
            ]),
        };

        await service.processEvent(makeEvent('BOOKING_APPROVED'));

        expect(deliverMock).toHaveBeenCalledTimes(1);
        expect(deliverMock).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'BOOKING_APPROVED' }),
            expect.stringContaining('Approved'),
            expect.stringContaining('Lab 101'),
        );
    });

    test('delivers BOOKING_REJECTED with reason in message', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const deliverMock = jest.fn().mockResolvedValue(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).registry = {
            getChannelsFor: jest.fn().mockReturnValue([
                { channelName: 'IN_APP', deliver: deliverMock },
            ]),
        };

        await service.processEvent(makeEvent('BOOKING_REJECTED', { reason: 'Lab unavailable', resourceName: 'Lab 202' }));

        const messageArg: string = deliverMock.mock.calls[0][2];
        expect(messageArg).toContain('Lab unavailable');
    });

    test('delivers ASSIGNMENT_PENDING with resource name', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const deliverMock = jest.fn().mockResolvedValue(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).registry = {
            getChannelsFor: jest.fn().mockReturnValue([
                { channelName: 'IN_APP', deliver: deliverMock },
            ]),
        };

        await service.processEvent(makeEvent('ASSIGNMENT_PENDING'));
        expect(deliverMock).toHaveBeenCalledTimes(1);
    });

    test('delivers ESCALATION_ASSIGNED notification', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const deliverMock = jest.fn().mockResolvedValue(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).registry = {
            getChannelsFor: jest.fn().mockReturnValue([
                { channelName: 'IN_APP', deliver: deliverMock },
            ]),
        };

        await service.processEvent(makeEvent('ESCALATION_ASSIGNED'));
        expect(deliverMock).toHaveBeenCalledTimes(1);
    });

    test('logs warning and skips unknown eventType gracefully', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const deliverMock = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).registry = { getChannelsFor: jest.fn().mockReturnValue([{ deliver: deliverMock }]) };

        // Force unknown event type
        await service.processEvent({ ...makeEvent(), eventType: 'UNKNOWN_TYPE' as never });

        expect(deliverMock).not.toHaveBeenCalled();
    });

    test('continues even if one channel fails (allSettled behaviour)', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const failingChannel = { channelName: 'EMAIL', deliver: jest.fn().mockRejectedValue(new Error('SMTP down')) };
        const workingChannel = { channelName: 'IN_APP', deliver: jest.fn().mockResolvedValue(true) };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).registry = {
            getChannelsFor: jest.fn().mockReturnValue([failingChannel, workingChannel]),
        };

        // Stub retryQueue so the enqueue path doesn't hit a real DB
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).retryQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };

        // Should not throw
        await expect(service.processEvent(makeEvent('BOOKING_APPROVED'))).resolves.toBeUndefined();
        expect(workingChannel.deliver).toHaveBeenCalled();
    });
});

// ── Query delegation tests ────────────────────────────────────────────────────

describe('NotificationService.getMyNotifications()', () => {
    test('delegates to repository', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const mockRepo = makeMockRepo({
            findByRecipientId: jest.fn().mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).repo = mockRepo;

        const result = await service.getMyNotifications('user-1');
        expect(result).toHaveLength(2);
        expect(mockRepo.findByRecipientId).toHaveBeenCalledWith('user-1');
    });
});

describe('NotificationService.getUnreadCount()', () => {
    test('returns count from repository', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const mockRepo = makeMockRepo({ countUnread: jest.fn().mockResolvedValue(3) });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).repo = mockRepo;

        const count = await service.getUnreadCount('user-1');
        expect(count).toBe(3);
    });
});

describe('NotificationService.markRead()', () => {
    test('returns null when notification not found', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const mockRepo = makeMockRepo({ markRead: jest.fn().mockResolvedValue(null) });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).repo = mockRepo;

        const result = await service.markRead('non-existent', 'user-1');
        expect(result).toBeNull();
    });
});

describe('NotificationService.markAllRead()', () => {
    test('returns number of marked notifications', async () => {
        const pool = makeMockPool();
        const service = new NotificationService(pool as never);

        const mockRepo = makeMockRepo({ markAllRead: jest.fn().mockResolvedValue(5) });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).repo = mockRepo;

        const count = await service.markAllRead('user-1');
        expect(count).toBe(5);
    });
});
