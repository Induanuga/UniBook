// src/utils/logger.ts
// Structured JSON logger — Tactic 5: Correlation IDs on every log line.
// Mirrors the pattern from Booking Engine utils/logger.ts for consistency.

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

interface LogPayload {
  correlationId?: string;
  component?:     string;
  [key: string]:  unknown;
}

function log(level: LogLevel, payload: LogPayload): void {
  const entry = {
    level,
    subsystem:  'ResourceCatalogue',
    timestamp:  new Date().toISOString(),
    ...payload,
  };
  if (level === 'ERROR') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info:  (payload: LogPayload) => log('INFO',  payload),
  warn:  (payload: LogPayload) => log('WARN',  payload),
  error: (payload: LogPayload) => log('ERROR', payload),
  debug: (payload: LogPayload) => log('DEBUG', payload),
};
