// src/utils/logger.ts
// Structured JSON logger — mirrors other subsystems.
const isTest = process.env.NODE_ENV === 'test';

function log(level: 'info' | 'warn' | 'error', data: Record<string, unknown>): void {
    if (isTest) return; // Suppress logs during tests
    const entry = JSON.stringify({ level, ...data, '@timestamp': new Date().toISOString() });
    if (level === 'error') {
        process.stderr.write(entry + '\n');
    } else {
        process.stdout.write(entry + '\n');
    }
}

export const logger = {
    info: (data: Record<string, unknown>) => log('info', data),
    warn: (data: Record<string, unknown>) => log('warn', data),
    error: (data: Record<string, unknown>) => log('error', data),
};
