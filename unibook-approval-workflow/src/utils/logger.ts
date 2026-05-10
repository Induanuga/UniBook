// src/utils/logger.ts
// Structured logger — Tactic 5: every log line is JSON with correlationId.
// Used by all Approval Workflow components.

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

interface LogPayload {
  correlationId?: string;
  component?:     string;
  [key: string]:  unknown;
}

function log(level: LogLevel, payload: LogPayload): void {
  const entry = {
    level,
    subsystem: 'ApprovalWorkflow',
    timestamp: new Date().toISOString(),
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
