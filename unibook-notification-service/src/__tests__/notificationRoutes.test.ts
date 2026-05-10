import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createNotificationRouter } from '../routes/notificationRoutes';
import type { NotificationService } from '../services/NotificationService';

// Must match the JWT_SECRET in .env (config default)
const JWT_SECRET = 'unibook-super-secret-key-change-in-production-min-256-bits';

function makeToken(role = 'STUDENT', userId = 'user-1'): string {
    return jwt.sign(
        { jti: 'j1', sub: userId, email: 'student@uni.edu', name: 'Alice', role, department: 'CS' },
        JWT_SECRET,
        { expiresIn: '1h' },
    );
}

function makeSampleNotification() {
    return {
        id: 'notif-1',
        recipientId: 'user-1',
        recipientEmail: 'student@uni.edu',
        eventType: 'BOOKING_APPROVED',
        title: '✅ Booking Approved',
        message: 'Your booking was approved.',
        channel: 'IN_APP',
        isRead: false,
        createdAt: new Date(),
    };
}

function makeMockService(overrides: Partial<Record<string, jest.Mock>> = {}): NotificationService {
    return {
        processEvent: overrides.processEvent ?? jest.fn().mockResolvedValue(undefined),
        getMyNotifications: overrides.getMyNotifications ?? jest.fn().mockResolvedValue([makeSampleNotification()]),
        getUnreadCount: overrides.getUnreadCount ?? jest.fn().mockResolvedValue(1),
        markRead: overrides.markRead ?? jest.fn().mockResolvedValue(makeSampleNotification()),
        markAllRead: overrides.markAllRead ?? jest.fn().mockResolvedValue(2),
    } as unknown as NotificationService;
}

function buildApp(service: NotificationService) {
    const app = express();
    app.use(express.json());
    // Inline correlationId middleware (avoids import chain)
    app.use((req, _res, next) => { req.correlationId = 'test-corr'; next(); });
    app.use('/notifications', createNotificationRouter(service));
    return app;
}

afterEach(() => jest.clearAllMocks());

// ── GET /notifications/my ─────────────────────────────────────────────────────

describe('GET /notifications/my', () => {
    test('returns notifications for authenticated user', async () => {
        const service = makeMockService();
        const app = buildApp(service);

        const res = await request(app)
            .get('/notifications/my')
            .set('Authorization', `Bearer ${makeToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.notifications).toHaveLength(1);
        expect(res.body.notifications[0].id).toBe('notif-1');
    });

    test('returns 401 without Authorization header', async () => {
        const service = makeMockService();
        const app = buildApp(service);

        const res = await request(app).get('/notifications/my');
        expect(res.status).toBe(401);
    });
});

// ── GET /notifications/unread-count ──────────────────────────────────────────

describe('GET /notifications/unread-count', () => {
    test('returns unread count for authenticated user', async () => {
        const service = makeMockService({ getUnreadCount: jest.fn().mockResolvedValue(3) });
        const app = buildApp(service);

        const res = await request(app)
            .get('/notifications/unread-count')
            .set('Authorization', `Bearer ${makeToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(3);
    });
});

// ── PATCH /notifications/read-all ─────────────────────────────────────────────

describe('PATCH /notifications/read-all', () => {
    test('marks all read and returns count', async () => {
        const service = makeMockService({ markAllRead: jest.fn().mockResolvedValue(4) });
        const app = buildApp(service);

        const res = await request(app)
            .patch('/notifications/read-all')
            .set('Authorization', `Bearer ${makeToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(4);
    });
});

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────

describe('PATCH /notifications/:id/read', () => {
    test('marks a single notification read', async () => {
        const service = makeMockService();
        const app = buildApp(service);

        const res = await request(app)
            .patch('/notifications/notif-1/read')
            .set('Authorization', `Bearer ${makeToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.notification.id).toBe('notif-1');
    });

    test('returns 404 when notification not found or not owned', async () => {
        const service = makeMockService({ markRead: jest.fn().mockResolvedValue(null) });
        const app = buildApp(service);

        const res = await request(app)
            .patch('/notifications/non-existent/read')
            .set('Authorization', `Bearer ${makeToken()}`);

        expect(res.status).toBe(404);
    });
});

// ── POST /notifications/internal/event ───────────────────────────────────────

describe('POST /notifications/internal/event', () => {
    const validPayload = {
        eventType: 'BOOKING_APPROVED',
        correlationId: 'corr-test',
        recipientId: 'user-1',
        recipientEmail: 'student@uni.edu',
        timestamp: new Date().toISOString(),
    };

    test('accepts valid event with correct service key and returns 202', async () => {
        const service = makeMockService();
        const app = buildApp(service);

        const res = await request(app)
            .post('/notifications/internal/event')
            .set('X-Service-Key', JWT_SECRET)
            .send(validPayload);

        expect(res.status).toBe(202);
    });

    test('rejects without service key — 401', async () => {
        const service = makeMockService();
        const app = buildApp(service);

        const res = await request(app)
            .post('/notifications/internal/event')
            .send(validPayload);

        expect(res.status).toBe(401);
    });

    test('rejects invalid payload — 400', async () => {
        const service = makeMockService();
        const app = buildApp(service);

        const res = await request(app)
            .post('/notifications/internal/event')
            .set('X-Service-Key', JWT_SECRET)
            .send({ eventType: 'BOOKING_APPROVED' }); // missing recipientId / recipientEmail

        expect(res.status).toBe(400);
    });
});
