// src/strategies/EmailNotificationChannel.ts
// Strategy — Concrete implementation: sends email via Nodemailer.
// This channel is disabled unless SMTP_HOST is configured in .env.
// When disabled, deliver() is a no-op that returns false gracefully.

import nodemailer from 'nodemailer';
import type { INotificationChannel } from './INotificationChannel';
import type { NotificationEvent } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class EmailNotificationChannel implements INotificationChannel {
    readonly channelName = 'EMAIL';

    private readonly transporter: nodemailer.Transporter | null;

    constructor() {
        if (config.smtp.enabled) {
            this.transporter = nodemailer.createTransport({
                host: config.smtp.host,
                port: config.smtp.port,
                auth: {
                    user: config.smtp.user,
                    pass: config.smtp.pass,
                },
            });
        } else {
            this.transporter = null;
        }
    }

    async deliver(event: NotificationEvent, title: string, message: string): Promise<boolean> {
        if (!this.transporter) {
            logger.info({
                correlationId: event.correlationId,
                component: 'EmailNotificationChannel',
                action: 'EMAIL_DISABLED',
                recipientEmail: event.recipientEmail,
            });
            return false;
        }

        try {
            await this.transporter.sendMail({
                from: config.smtp.from,
                to: event.recipientEmail,
                subject: `[UniBook] ${title}`,
                text: message,
                html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
                    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px 32px">
                      <h1 style="color:white;margin:0;font-size:1.4rem">📚 UniBook</h1>
                      <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:0.85rem">University Resource Booking System</p>
                    </div>
                    <div style="padding:24px 32px">
                      <h2 style="color:#1f2937;margin:0 0 12px">${title}</h2>
                      <p style="color:#374151;line-height:1.6">${message}</p>
                    </div>
                    <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
                      <p style="color:#9ca3af;font-size:0.8rem;margin:0">This is an automated notification from UniBook. Please do not reply to this email.</p>
                    </div>
                  </div>`,
            });

            logger.info({
                correlationId: event.correlationId,
                component: 'EmailNotificationChannel',
                action: 'EMAIL_SENT',
                eventType: event.eventType,
                recipientEmail: event.recipientEmail,
            });

            return true;
        } catch (err) {
            logger.error({
                correlationId: event.correlationId,
                component: 'EmailNotificationChannel',
                action: 'EMAIL_FAILED',
                recipientEmail: event.recipientEmail,
                error: (err as Error).message,
            });
            return false;
        }
    }
}
