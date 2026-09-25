import 'dotenv/config';
import os from 'os';
import path from 'path';

const jwtSecret = process.env.JWT_SECRET || 'brain-core-jwt-secret-2025';

export function parseTrustedProxies(value: string | undefined): false | string[] {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length ? entries : false;
}

if (jwtSecret === 'brain-core-jwt-secret-2025' || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET inseguro. Defina um segredo forte com pelo menos 32 caracteres.');
}

export const config = {
  HOST: process.env.HOST || '127.0.0.1',
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'brain_core_db',
    user: process.env.DB_USER || 'brain_core_app',
    password: process.env.DB_PASSWORD || '',
  },
  INITIAL_ADMIN_EMAIL: (process.env.INITIAL_ADMIN_EMAIL || '').trim(),
  INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD || '',
  INITIAL_ADMIN_NAME: (process.env.INITIAL_ADMIN_NAME || '').trim(),
  SEED_DEMO_DATA: process.env.SEED_DEMO_DATA === 'true',
  CORS_ORIGINS: String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  TRUSTED_PROXIES: parseTrustedProxies(process.env.TRUSTED_PROXIES),
  MD_SOURCE_PATH: process.env.MD_SOURCE_PATH || '../data/markdown',
  UPLOADS_DIR: process.env.UPLOADS_DIR || path.resolve(__dirname, '..', '..', 'uploads'),
  UPLOADS_MAX_BYTES: parseInt(process.env.UPLOADS_MAX_BYTES || String(5 * 1024 * 1024 * 1024), 10),
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || 'brain_core_session',
  AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE === 'true'
    ? true
    : process.env.AUTH_COOKIE_SECURE === 'false'
      ? false
      : null,
  TRUSTED_DEVICE_COOKIE_NAME: process.env.TRUSTED_DEVICE_COOKIE_NAME || 'brain_core_trusted_device',
  TRUSTED_DEVICE_MAX_AGE_DAYS: parseInt(process.env.TRUSTED_DEVICE_MAX_AGE_DAYS || '30', 10),
  TOTP_ISSUER: process.env.TOTP_ISSUER || 'Brain Core',
  TWO_FACTOR_PENDING_EXPIRES_IN: process.env.TWO_FACTOR_PENDING_EXPIRES_IN || '5m',
  LOGIN_IP_WINDOW_MS: parseInt(process.env.LOGIN_IP_WINDOW_MS || '900000', 10),
  LOGIN_IP_MAX_ATTEMPTS: parseInt(process.env.LOGIN_IP_MAX_ATTEMPTS || '25', 10),
  LOGIN_ACCOUNT_WINDOW_MS: parseInt(process.env.LOGIN_ACCOUNT_WINDOW_MS || '1800000', 10),
  LOGIN_ACCOUNT_MAX_ATTEMPTS: parseInt(process.env.LOGIN_ACCOUNT_MAX_ATTEMPTS || '5', 10),
  LOGIN_LOCK_MS: parseInt(process.env.LOGIN_LOCK_MS || '1800000', 10),
  PASSWORD_MIN_LENGTH: parseInt(process.env.PASSWORD_MIN_LENGTH || '12', 10),
  TERMINAL_ENABLED: process.env.TERMINAL_ENABLED === 'true',
  TERMINAL_DEFAULT_DIR: process.env.TERMINAL_DEFAULT_DIR || path.join(os.homedir(), 'brain-core'),
  TERMINAL_ALLOWED_ROOTS: process.env.TERMINAL_ALLOWED_ROOTS || [
    path.join(os.homedir()),
    '/tmp',
  ].join(':'),
  TERMINAL_TMUX_SOCKET: process.env.TERMINAL_TMUX_SOCKET || path.join(os.homedir(), '.brain-core', 'tmux.sock'),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || '',
  REMEMBER_REMINDER_INTERVAL_MS: parseInt(process.env.REMEMBER_REMINDER_INTERVAL_MS || '60000', 10),
  CELTWO_MEMORY_URL: process.env.CELTWO_MEMORY_URL || '',
  CELTWO_MEMORY_TOKEN: process.env.CELTWO_MEMORY_TOKEN || '',
  CELTWO_MEMORY_MODE: (process.env.CELTWO_MEMORY_MODE || (process.env.NODE_ENV === 'production' ? 'offline' : 'mock')) as 'mock' | 'proxy' | 'offline',
  CELTWO_MEMORY_TIMEOUT_MS: parseInt(process.env.CELTWO_MEMORY_TIMEOUT_MS || '5000', 10),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_ORGANIZE_MODEL: process.env.OPENAI_ORGANIZE_MODEL || 'gpt-4o-mini',
  OPENAI_TIMEOUT_MS: parseInt(process.env.OPENAI_TIMEOUT_MS || '30000', 10),
  TRASH_RETENTION_DAYS: parseInt(process.env.TRASH_RETENTION_DAYS || '30', 10),
  TRASH_CLEANUP_INTERVAL_MS: parseInt(process.env.TRASH_CLEANUP_INTERVAL_MS || '3600000', 10),
  PAGE_VERSION_RETENTION: parseInt(process.env.PAGE_VERSION_RETENTION || '100', 10),
};
