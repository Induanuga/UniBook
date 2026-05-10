// src/config/index.ts
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/unibook',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'unibook-dev-secret-must-change',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    expiresInMs: 8 * 60 * 60 * 1000,
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'unibook-refresh-dev-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    refreshExpiresInMs: 7 * 24 * 60 * 60 * 1000,
  },

  cors: {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 20,
  },

  cas: {
    serverUrl:   process.env.CAS_SERVER_URL   || 'https://cas.university.edu',
    serviceUrl:  process.env.CAS_SERVICE_URL  || 'http://localhost:3001/auth/cas/callback',
    defaultRole: (process.env.CAS_DEFAULT_ROLE || 'STUDENT') as
                 'STUDENT' | 'FACULTY' | 'ADMIN' | 'IT_STAFF',
  },
};
