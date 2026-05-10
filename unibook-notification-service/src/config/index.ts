// src/config/index.ts
// Notification Service configuration — loaded from .env
import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: parseInt(process.env.PORT || '3005', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    db: {
        url: process.env.DATABASE_URL || 'postgresql://unibook:unibook123@localhost:5432/unibook_notification',
    },

    jwt: {
        secret: process.env.JWT_SECRET || 'unibook-dev-secret-must-change',
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    },

    cors: {
        frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    },

    services: {
        iamUrl: process.env.IAM_SERVICE_URL || 'http://localhost:3001',
        approvalWorkflowUrl: process.env.APPROVAL_WORKFLOW_URL || 'http://localhost:3004',
    },

    rateLimit: {
        max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
    },

    smtp: {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || 'noreply@unibook.edu',
        // Email channel is enabled only when SMTP_HOST is provided
        enabled: !!process.env.SMTP_HOST,
    },
};
