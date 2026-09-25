import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { pool, query } from '../config/database';
import { config } from '../config';
import { getClientIp } from '../middleware/clientIp';
import { AuthRequest } from '../middleware/auth';
import { clearFailedIpLoginAttempts, registerFailedIpLoginAttempt } from '../services/loginProtectionService';
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from '../services/totpService';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  failed_login_attempts: number;
  failed_login_window_started_at: string | null;
  login_locked_until: string | null;
  session_version: number;
  two_factor_enabled?: boolean;
  two_factor_secret?: string | null;
  two_factor_pending_secret?: string | null;
  telegram_chat_id?: string | null;
  telegram_notifications_enabled?: boolean;
}

interface TwoFactorPendingPayload {
  sub: string;
  sv: number;
  type: '2fa-pending';
}

interface TrustedDeviceRow {
  id: string;
  selector: string;
  verifier_hash: string;
  expires_at: string;
}

const DUMMY_PASSWORD_HASH = '$2b$10$6hYvK0N0JmY5lY4a7WmM8e4K8.I9d8R3G9G7mP0x4Xf9Q8n2r2w8K';
const ACCESS_TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TRUSTED_DEVICE_MAX_AGE_MS = Math.max(1, config.TRUSTED_DEVICE_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function validatePasswordStrength(password: string): string | null {
  if (password.length < config.PASSWORD_MIN_LENGTH) {
    return `A nova senha deve ter pelo menos ${config.PASSWORD_MIN_LENGTH} caracteres`;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'A nova senha deve conter letras e números';
  }
  return null;
}

async function delayFailedLoginResponse(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
}

function buildSignOptions(expiresIn: string): SignOptions {
  return {
    expiresIn: expiresIn as SignOptions['expiresIn'],
  };
}

function buildAccessToken(userId: string, email: string | null, sessionVersion: number): string {
  return jwt.sign(
    { sub: userId, email, sv: sessionVersion, type: 'access' },
    config.JWT_SECRET,
    buildSignOptions(config.JWT_EXPIRES_IN)
  );
}

function buildTwoFactorPendingToken(userId: string, sessionVersion: number): string {
  return jwt.sign(
    { sub: userId, sv: sessionVersion, type: '2fa-pending' },
    config.JWT_SECRET,
    buildSignOptions(config.TWO_FACTOR_PENDING_EXPIRES_IN)
  );
}

function verifyTwoFactorPendingToken(token: string): TwoFactorPendingPayload | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as Partial<TwoFactorPendingPayload>;
    if (!payload.sub || !Number.isInteger(payload.sv) || payload.type !== '2fa-pending') {
      return null;
    }
    return payload as TwoFactorPendingPayload;
  } catch {
    return null;
  }
}

function parseCookies(rawCookieHeader: string | undefined): Record<string, string> {
  if (!rawCookieHeader) return {};
  return rawCookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const index = part.indexOf('=');
    if (index <= 0) return acc;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function isSecureRequest(req: Request): boolean {
  if (config.AUTH_COOKIE_SECURE !== null) return config.AUTH_COOKIE_SECURE;
  return req.secure;
}

function buildCookie(name: string, value: string, maxAgeMs: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function clearCookie(name: string, secure: boolean): string {
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function buildAuthCookie(req: Request, token: string, maxAgeMs = ACCESS_TOKEN_MAX_AGE_MS): string {
  return buildCookie(config.AUTH_COOKIE_NAME, token, maxAgeMs, isSecureRequest(req));
}

function clearAuthCookie(req: Request): string {
  return clearCookie(config.AUTH_COOKIE_NAME, isSecureRequest(req));
}

function buildTrustedDeviceCookie(req: Request, token: string): string {
  return buildCookie(config.TRUSTED_DEVICE_COOKIE_NAME, token, TRUSTED_DEVICE_MAX_AGE_MS, isSecureRequest(req));
}

function clearTrustedDeviceCookie(req: Request): string {
  return clearCookie(config.TRUSTED_DEVICE_COOKIE_NAME, isSecureRequest(req));
}

function hashTrustedDeviceVerifier(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseTrustedDeviceCookie(rawCookieHeader: string | undefined): { selector: string; verifier: string } | null {
  const cookies = parseCookies(rawCookieHeader);
  const rawValue = cookies[config.TRUSTED_DEVICE_COOKIE_NAME];
  if (!rawValue) return null;
  const [selector, verifier] = rawValue.split('.', 2);
  if (!selector || !verifier) return null;
  if (!/^[a-f0-9]{18,64}$/i.test(selector)) return null;
  if (!/^[A-Za-z0-9_-]{20,}$/u.test(verifier)) return null;
  return { selector, verifier };
}

function getTrustedDeviceLabel(req: Request): string {
  const userAgent = String(req.headers['user-agent'] ?? '').trim().replace(/\s+/g, ' ');
  return userAgent ? userAgent.slice(0, 160) : 'Dispositivo confiável';
}

async function clearTrustedDevicesForUser(userId: string): Promise<void> {
  await query('DELETE FROM trusted_devices WHERE user_id = $1', [userId]);
}

async function createTrustedDevice(req: Request, userId: string): Promise<string> {
  const selector = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(24).toString('base64url');
  const verifierHash = hashTrustedDeviceVerifier(verifier);
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_MAX_AGE_MS);

  await query(
    `INSERT INTO trusted_devices (user_id, selector, verifier_hash, name, user_agent, last_ip, last_used_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
    [
      userId,
      selector,
      verifierHash,
      getTrustedDeviceLabel(req),
      String(req.headers['user-agent'] ?? '').slice(0, 500) || null,
      getClientIp(req),
      expiresAt.toISOString(),
    ]
  );

  return `${selector}.${verifier}`;
}

async function consumeTrustedDevice(req: Request, userId: string): Promise<{ cookieValue: string } | null> {
  const parsed = parseTrustedDeviceCookie(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined);
  if (!parsed) return null;

  const rows = await query<TrustedDeviceRow>(
    `SELECT id, selector, verifier_hash, expires_at
     FROM trusted_devices
     WHERE user_id = $1
       AND selector = $2`,
    [userId, parsed.selector]
  );

  const device = rows[0];
  if (!device) {
    return null;
  }

  const expiresAt = new Date(device.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await query('DELETE FROM trusted_devices WHERE id = $1', [device.id]);
    return null;
  }

  const providedHash = hashTrustedDeviceVerifier(parsed.verifier);
  if (!safeEqualHex(device.verifier_hash, providedHash)) {
    await query('DELETE FROM trusted_devices WHERE id = $1', [device.id]);
    return null;
  }

  // Rotate the verifier on every use so a stolen cookie is invalidated as soon
  // as the legitimate device (or the attacker) authenticates again.
  const nextVerifier = crypto.randomBytes(24).toString('base64url');
  const nextVerifierHash = hashTrustedDeviceVerifier(nextVerifier);
  const nextExpiresAt = new Date(Date.now() + TRUSTED_DEVICE_MAX_AGE_MS);
  await query(
    `UPDATE trusted_devices
     SET verifier_hash = $1,
         last_ip = $2,
         user_agent = $3,
         last_used_at = NOW(),
         expires_at = $4
     WHERE id = $5`,
    [
      nextVerifierHash,
      getClientIp(req),
      String(req.headers['user-agent'] ?? '').slice(0, 500) || null,
      nextExpiresAt.toISOString(),
      device.id,
    ]
  );

  return { cookieValue: `${device.selector}.${nextVerifier}` };
}

async function registerFailedAccountAttempt(user: UserRow): Promise<{ lockedUntil: string | null }> {
  const timestamp = new Date();
  const windowStartedAt = user.failed_login_window_started_at ? new Date(user.failed_login_window_started_at) : null;
  const insideWindow = !!windowStartedAt && (timestamp.getTime() - windowStartedAt.getTime()) <= config.LOGIN_ACCOUNT_WINDOW_MS;
  const nextAttempts = insideWindow ? user.failed_login_attempts + 1 : 1;
  const nextWindowStartedAt = insideWindow ? windowStartedAt : timestamp;
  const lockedUntil = nextAttempts >= config.LOGIN_ACCOUNT_MAX_ATTEMPTS
    ? new Date(timestamp.getTime() + config.LOGIN_LOCK_MS)
    : null;

  await query(
    `UPDATE users
     SET failed_login_attempts = $1,
         failed_login_window_started_at = $2,
         login_locked_until = $3
     WHERE id = $4`,
    [nextAttempts, nextWindowStartedAt?.toISOString() ?? null, lockedUntil?.toISOString() ?? null, user.id]
  );

  return { lockedUntil: lockedUntil?.toISOString() ?? null };
}

async function clearFailedAccountAttempts(userId: string): Promise<void> {
  await query(
    `UPDATE users
     SET failed_login_attempts = 0,
         failed_login_window_started_at = NULL,
         login_locked_until = NULL,
         last_login_at = NOW()
     WHERE id = $1`,
    [userId]
  );
}

async function loadLoginUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    `SELECT id, email, password_hash, name,
            failed_login_attempts, failed_login_window_started_at, login_locked_until, session_version,
            two_factor_enabled, two_factor_secret
     FROM users
     WHERE email = $1`,
    [normalizeEmail(email)]
  );

  return rows[0] ?? null;
}

async function loadUserById(userId: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    `SELECT id, email, password_hash, name,
            failed_login_attempts, failed_login_window_started_at, login_locked_until, session_version,
            two_factor_enabled, two_factor_secret, two_factor_pending_secret,
            telegram_chat_id, telegram_notifications_enabled
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return rows[0] ?? null;
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'Email e senha são obrigatórios' });
    return;
  }

  try {
    const user = await loadLoginUserByEmail(email);

    if (!user) {
      registerFailedIpLoginAttempt(req);
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      await delayFailedLoginResponse();
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    const lockedUntil = user.login_locked_until ? new Date(user.login_locked_until) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      registerFailedIpLoginAttempt(req);
      const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Conta temporariamente bloqueada por excesso de tentativas. Aguarde antes de tentar novamente.',
        retryAfterSeconds,
      });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      registerFailedIpLoginAttempt(req);
      const failedState = await registerFailedAccountAttempt(user);
      await delayFailedLoginResponse();
      if (failedState.lockedUntil) {
        const retryAfterSeconds = Math.max(1, Math.ceil((new Date(failedState.lockedUntil).getTime() - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.status(429).json({
          error: 'Conta temporariamente bloqueada por excesso de tentativas. Aguarde antes de tentar novamente.',
          retryAfterSeconds,
        });
        return;
      }
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    if (user.two_factor_enabled && user.two_factor_secret) {
      const trustedDevice = await consumeTrustedDevice(req, user.id);
      if (trustedDevice) {
        await clearFailedAccountAttempts(user.id);
        clearFailedIpLoginAttempts(req);

        const token = buildAccessToken(user.id, user.email, user.session_version);
        res.setHeader('Set-Cookie', [
          buildAuthCookie(req, token),
          buildTrustedDeviceCookie(req, trustedDevice.cookieValue),
        ]);
        res.json({
          requiresTwoFactor: false,
          expiresIn: config.JWT_EXPIRES_IN,
          user: { id: user.id, email: user.email, name: user.name },
        });
        return;
      }

      res.json({
        requiresTwoFactor: true,
        pendingToken: buildTwoFactorPendingToken(user.id, user.session_version),
        expiresIn: config.TWO_FACTOR_PENDING_EXPIRES_IN,
      });
      return;
    }

    await clearFailedAccountAttempts(user.id);
    clearFailedIpLoginAttempts(req);

    const token = buildAccessToken(user.id, user.email, user.session_version);
    res.setHeader('Set-Cookie', buildAuthCookie(req, token));
    res.json({
      requiresTwoFactor: false,
      expiresIn: config.JWT_EXPIRES_IN,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function initialSetupStatus(_req: Request, res: Response): Promise<void> {
  try {
    const users = await query<{ id: string }>('SELECT id FROM users LIMIT 1');
    res.json({ setupRequired: users.length === 0 });
  } catch {
    res.status(500).json({ error: 'Não foi possível verificar o estado inicial' });
  }
}

/**
 * Creates the only account allowed to use this public endpoint. The explicit
 * table lock makes the empty-database check and insert a single operation,
 * preventing two simultaneous first-access requests from both becoming admin.
 */
export async function completeInitialSetup(req: Request, res: Response): Promise<void> {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : '';

  if (!normalizedName || normalizedName.length > 120 || !normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !password) {
    registerFailedIpLoginAttempt(req);
    res.status(400).json({ error: 'Informe nome, e-mail válido e senha.' });
    return;
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    registerFailedIpLoginAttempt(req);
    res.status(400).json({ error: passwordError });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const existing = await client.query<{ id: string }>('SELECT id FROM users LIMIT 1');
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'A configuração inicial já foi concluída.' });
      return;
    }

    const created = await client.query<Pick<UserRow, 'id' | 'email' | 'name' | 'session_version'>>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, session_version`,
      [normalizedEmail, passwordHash, normalizedName],
    );
    await client.query('COMMIT');

    const user = created.rows[0];
    clearFailedIpLoginAttempts(req);
    const token = buildAccessToken(user.id, user.email, user.session_version);
    res.setHeader('Set-Cookie', buildAuthCookie(req, token));
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      expiresIn: config.JWT_EXPIRES_IN,
    });
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    res.status(500).json({ error: 'Não foi possível concluir a configuração inicial.' });
  } finally {
    client.release();
  }
}

export async function verifyLoginTwoFactor(req: Request, res: Response): Promise<void> {
  const { pendingToken, code, rememberDevice } = req.body as {
    pendingToken?: string;
    code?: string;
    rememberDevice?: boolean;
  };
  if (!pendingToken || !code) {
    res.status(400).json({ error: 'Token pendente e código 2FA são obrigatórios' });
    return;
  }

  const pending = verifyTwoFactorPendingToken(pendingToken);
  if (!pending) {
    res.status(401).json({ error: 'Sessão de login 2FA expirada. Faça login novamente.' });
    return;
  }

  try {
    const user = await loadUserById(pending.sub);
    if (!user || user.session_version !== pending.sv || !user.two_factor_enabled || !user.two_factor_secret) {
      res.status(401).json({ error: 'Sessão de login 2FA expirada. Faça login novamente.' });
      return;
    }

    if (!verifyTotp(user.two_factor_secret, code)) {
      registerFailedIpLoginAttempt(req);
      const failedState = await registerFailedAccountAttempt(user);
      await delayFailedLoginResponse();
      if (failedState.lockedUntil) {
        const retryAfterSeconds = Math.max(1, Math.ceil((new Date(failedState.lockedUntil).getTime() - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.status(429).json({
          error: 'Conta temporariamente bloqueada por excesso de tentativas. Aguarde antes de tentar novamente.',
          retryAfterSeconds,
        });
        return;
      }
      res.status(401).json({ error: 'Código 2FA inválido' });
      return;
    }

    await clearFailedAccountAttempts(user.id);
    clearFailedIpLoginAttempts(req);

    const token = buildAccessToken(user.id, user.email, user.session_version);
    const cookies = [buildAuthCookie(req, token)];
    if (rememberDevice !== false) {
      const trustedDeviceCookie = await createTrustedDevice(req, user.id);
      cookies.push(buildTrustedDeviceCookie(req, trustedDeviceCookie));
    }
    res.setHeader('Set-Cookie', cookies);
    res.json({
      requiresTwoFactor: false,
      expiresIn: config.JWT_EXPIRES_IN,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function logout(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }
  try {
    await query(
      `UPDATE users
       SET session_version = session_version + 1
       WHERE id = $1`,
      [req.userId]
    );
    res.setHeader('Set-Cookie', clearAuthCookie(req));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
    return;
  }

  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  if (currentPassword === newPassword) {
    res.status(400).json({ error: 'A nova senha precisa ser diferente da senha atual' });
    return;
  }

  try {
    const user = await loadUserById(req.userId);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Senha atual incorreta' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    const nextSessionVersion = user.session_version + 1;

    await query(
      `UPDATE users
       SET password_hash = $1,
           session_version = $2,
           password_changed_at = NOW(),
           failed_login_attempts = 0,
           failed_login_window_started_at = NULL,
           login_locked_until = NULL
       WHERE id = $3`,
      [newHash, nextSessionVersion, req.userId]
    );
    await clearTrustedDevicesForUser(req.userId);

    const token = buildAccessToken(req.userId, user.email, nextSessionVersion);
    res.setHeader('Set-Cookie', [
      buildAuthCookie(req, token),
      clearTrustedDeviceCookie(req),
    ]);
    res.json({ ok: true, expiresIn: config.JWT_EXPIRES_IN });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = await loadUserById(String(req.userId || ''));
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      telegram_chat_id: user.telegram_chat_id ?? null,
      telegram_notifications_enabled: user.telegram_notifications_enabled === true,
      two_factor_enabled: user.two_factor_enabled === true,
      two_factor_setup_pending: user.two_factor_enabled !== true && !!user.two_factor_pending_secret,
    });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function beginTwoFactorSetup(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const { currentPassword } = req.body as { currentPassword?: string };
  if (!currentPassword) {
    res.status(400).json({ error: 'Senha atual obrigatória' });
    return;
  }

  try {
    const user = await loadUserById(req.userId);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Senha atual incorreta' });
      return;
    }

    const secret = user.two_factor_pending_secret || generateTotpSecret();
    await query(
      `UPDATE users
       SET two_factor_pending_secret = $1
       WHERE id = $2`,
      [secret, req.userId]
    );

    res.json({
      secret,
      otpauthUri: buildOtpAuthUri(user.email, secret),
    });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function confirmTwoFactorSetup(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ error: 'Código 2FA obrigatório' });
    return;
  }

  try {
    const user = await loadUserById(req.userId);
    if (!user || !user.two_factor_pending_secret) {
      res.status(400).json({ error: 'Nenhuma configuração 2FA pendente' });
      return;
    }

    if (!verifyTotp(user.two_factor_pending_secret, code)) {
      res.status(401).json({ error: 'Código 2FA inválido' });
      return;
    }

    const nextSessionVersion = user.session_version + 1;
    await query(
      `UPDATE users
       SET two_factor_enabled = TRUE,
           two_factor_secret = two_factor_pending_secret,
           two_factor_pending_secret = NULL,
           session_version = $1
       WHERE id = $2`,
      [nextSessionVersion, req.userId]
    );
    await clearTrustedDevicesForUser(req.userId);

    const token = buildAccessToken(req.userId, user.email, nextSessionVersion);
    res.setHeader('Set-Cookie', [
      buildAuthCookie(req, token),
      clearTrustedDeviceCookie(req),
    ]);
    res.json({ ok: true, two_factor_enabled: true, two_factor_setup_pending: false });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function disableTwoFactor(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const { currentPassword, code } = req.body as { currentPassword?: string; code?: string };
  if (!currentPassword || !code) {
    res.status(400).json({ error: 'Senha atual e código 2FA são obrigatórios' });
    return;
  }

  try {
    const user = await loadUserById(req.userId);
    if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
      res.status(400).json({ error: '2FA não está ativado' });
      return;
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Senha atual incorreta' });
      return;
    }

    if (!verifyTotp(user.two_factor_secret, code)) {
      res.status(401).json({ error: 'Código 2FA inválido' });
      return;
    }

    const nextSessionVersion = user.session_version + 1;
    await query(
      `UPDATE users
       SET two_factor_enabled = FALSE,
           two_factor_secret = NULL,
           two_factor_pending_secret = NULL,
           session_version = $1
       WHERE id = $2`,
      [nextSessionVersion, req.userId]
    );
    await clearTrustedDevicesForUser(req.userId);

    const token = buildAccessToken(req.userId, user.email, nextSessionVersion);
    res.setHeader('Set-Cookie', [
      buildAuthCookie(req, token),
      clearTrustedDeviceCookie(req),
    ]);
    res.json({ ok: true, two_factor_enabled: false, two_factor_setup_pending: false });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
}

export async function updateTelegramSettings(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const telegramChatId = typeof req.body?.telegramChatId === 'string' ? req.body.telegramChatId.trim().slice(0, 64) : '';
  const telegramNotificationsEnabled = req.body?.telegramNotificationsEnabled === true;

  const rows = await query<UserRow>(
    `UPDATE users
     SET telegram_chat_id = $1,
         telegram_notifications_enabled = $2
     WHERE id = $3
     RETURNING id, email, name, telegram_chat_id, telegram_notifications_enabled, two_factor_enabled`,
    [telegramChatId || null, telegramNotificationsEnabled, userId],
  );

  if (!rows.length) {
    res.status(404).json({ error: 'Usuário não encontrado' });
    return;
  }

  const updatedUser = rows[0];
  res.json({
    id: updatedUser.id,
    email: updatedUser.email,
    name: updatedUser.name,
    telegram_chat_id: updatedUser.telegram_chat_id ?? null,
    telegram_notifications_enabled: updatedUser.telegram_notifications_enabled === true,
    two_factor_enabled: updatedUser.two_factor_enabled === true,
    two_factor_setup_pending: false,
  });
}
