import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { config } from '../config';
import { logInfo, logWarn } from '../utils/logger';

interface CreateTerminalSessionOptions {
  ownerSocketId: string;
  userId: string;
  workspaceKey: string;
  requestedCwd?: string | null;
  cols?: number;
  rows?: number;
}

export interface TerminalSession {
  id: string;
  ownerSocketId: string;
  userId: string;
  cwd: string;
  workspaceKey: string;
  tmuxSession: string;
  pty: IPty;
  revision: number;
}

export type TerminalNavigateAction = 'page_up' | 'page_down' | 'top' | 'bottom';

const sessions = new Map<string, TerminalSession>();
const TMUX_ENV_POLICY_VERSION = '1';
let legacyTmuxCleanupComplete = false;

export function buildTerminalEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const user = source.USER || source.LOGNAME || os.userInfo().username;
  const env: Record<string, string> = {
    HOME: source.HOME || os.homedir(),
    USER: user,
    LOGNAME: source.LOGNAME || user,
    SHELL: source.SHELL || '/bin/sh',
    PATH: source.PATH || '/usr/local/bin:/usr/bin:/bin',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };

  if (source.LANG) env.LANG = source.LANG;
  for (const [key, value] of Object.entries(source)) {
    if (/^LC_[A-Z_]+$/.test(key) && typeof value === 'string' && value) env[key] = value;
  }
  return env;
}

function resolveTmuxSocketPath(): string {
  return `${resolveLegacyTmuxSocketPath()}.env-v${TMUX_ENV_POLICY_VERSION}`;
}

function resolveLegacyTmuxSocketPath(): string {
  return path.resolve(expandHome(config.TERMINAL_TMUX_SOCKET));
}

function ensureTmuxSocketDirectory(): string {
  const socketPath = resolveTmuxSocketPath();
  const socketDir = path.dirname(socketPath);
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  return socketPath;
}

function tmuxArgs(args: string[]): string[] {
  return ['-S', ensureTmuxSocketDirectory(), ...args];
}

function runTmuxQuiet(args: string[]): void {
  execFileSync('tmux', tmuxArgs(args), {
    env: buildTerminalEnvironment(),
    stdio: 'ignore',
  });
}

function runTmuxText(args: string[], maxBuffer?: number): string {
  return execFileSync('tmux', tmuxArgs(args), {
    env: buildTerminalEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    ...(maxBuffer ? { maxBuffer } : {}),
  });
}

function expandHome(input: string): string {
  if (!input.startsWith('~')) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

function parseAllowedRoots(): string[] {
  return config.TERMINAL_ALLOWED_ROOTS
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(expandHome)
    .map((entry) => path.resolve(entry));
}

function safeRealpath(candidate: string): string | null {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

function isInsideAllowedRoots(candidate: string, allowedRoots: string[]): boolean {
  const realCandidate = safeRealpath(candidate);
  if (!realCandidate) return false;

  return allowedRoots.some((root) => {
    const realRoot = safeRealpath(root);
    if (!realRoot) return false;
    return realCandidate === realRoot || realCandidate.startsWith(`${realRoot}${path.sep}`);
  });
}

function resolveWorkingDirectory(requestedCwd?: string | null): string {
  const allowedRoots = parseAllowedRoots();
  const defaultDir = path.resolve(expandHome(config.TERMINAL_DEFAULT_DIR));
  const preferred = requestedCwd ? path.resolve(expandHome(requestedCwd)) : defaultDir;

  if (isInsideAllowedRoots(preferred, allowedRoots)) {
    return preferred;
  }

  if (isInsideAllowedRoots(defaultDir, allowedRoots)) {
    return defaultDir;
  }

  return allowedRoots[0] || os.homedir();
}

function sanitizeSessionName(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);

  return normalized || 'workspace';
}

function buildTmuxSessionName(userId: string, workspaceKey: string): string {
  const prefix = sanitizeSessionName(workspaceKey);
  const hash = createHash('sha1')
    .update(`${userId}:${workspaceKey}`)
    .digest('hex')
    .slice(0, 10);
  return `bc-${prefix}-${hash}`;
}

function ensureTmuxInstalled(): void {
  try {
    execFileSync('tmux', ['-V'], { env: buildTerminalEnvironment(), stdio: 'ignore' });
  } catch {
    throw new Error('tmux nao esta instalado no servidor');
  }
}

function ensureTmuxEnvironmentPolicy(): void {
  if (legacyTmuxCleanupComplete) return;
  legacyTmuxCleanupComplete = true;
  try {
    execFileSync('tmux', ['-S', resolveLegacyTmuxSocketPath(), 'kill-server'], {
      env: buildTerminalEnvironment(),
      stdio: 'ignore',
    });
    logWarn('terminal.tmux.environment_policy.legacy_server_stopped');
  } catch {
    // No pre-policy tmux server exists on the legacy socket.
  }
}

function ensureTmuxSession(sessionName: string, cwd: string): void {
  ensureTmuxEnvironmentPolicy();
  try {
    runTmuxQuiet(['has-session', '-t', sessionName]);
  } catch {
    try {
      runTmuxQuiet(['new-session', '-d', '-s', sessionName, '-c', cwd]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new Error(`Falha ao criar sessao tmux: ${detail}`);
    }
  }

  try {
    runTmuxQuiet(['set-option', '-g', 'update-environment', '']);
    runTmuxQuiet(['set-option', '-t', sessionName, 'mouse', 'off']);
  } catch {
    logWarn('terminal.tmux.mouse.disable.failed', { sessionName });
  }
}

function readTmuxCurrentPath(sessionName: string, fallbackCwd: string): string {
  try {
    const output = runTmuxText(['display-message', '-p', '-t', sessionName, '#{pane_current_path}']).trim();

    return output || fallbackCwd;
  } catch {
    return fallbackCwd;
  }
}

function readTmuxSnapshot(sessionName: string): string {
  try {
    return runTmuxText(['capture-pane', '-p', '-e', '-J', '-S', '-2000', '-t', sessionName], 2 * 1024 * 1024);
  } catch {
    return '';
  }
}

function destroyTmuxSession(sessionName: string): void {
  try {
    runTmuxQuiet(['kill-session', '-t', sessionName]);
  } catch {
    // The session may already be gone if the shell exited on its own.
  }
}

function tmuxSessionExists(sessionName: string): boolean {
  try {
    runTmuxQuiet(['has-session', '-t', sessionName]);
    return true;
  } catch {
    return false;
  }
}

function spawnAttachedPty(tmuxSession: string, cwd: string, cols?: number, rows?: number): IPty {
  return pty.spawn('tmux', tmuxArgs(['attach-session', '-t', tmuxSession]), {
    name: 'xterm-256color',
    cwd,
    cols: Math.max(40, cols ?? 120),
    rows: Math.max(12, rows ?? 30),
    env: {
      ...buildTerminalEnvironment(),
    },
  });
}

export function createTerminalSession(options: CreateTerminalSessionOptions): TerminalSession {
  if (!config.TERMINAL_ENABLED) {
    throw new Error('Terminal desativado');
  }

  ensureTmuxInstalled();

  const cwd = resolveWorkingDirectory(options.requestedCwd);
  const tmuxSession = buildTmuxSessionName(options.userId, options.workspaceKey);
  ensureTmuxSession(tmuxSession, cwd);
  const attachPty = spawnAttachedPty(tmuxSession, cwd, options.cols, options.rows);

  const session: TerminalSession = {
    id: randomUUID(),
    ownerSocketId: options.ownerSocketId,
    userId: options.userId,
    workspaceKey: options.workspaceKey,
    tmuxSession,
    cwd: readTmuxCurrentPath(tmuxSession, cwd),
    pty: attachPty,
    revision: 0,
  };

  sessions.set(session.id, session);
  logInfo('terminal.session.create', {
    sessionId: session.id,
    userId: options.userId,
    workspaceKey: options.workspaceKey,
    cwd: session.cwd,
    tmuxSession,
  });
  return session;
}

export function attachTerminalSession(
  sessionId: string,
  userId: string,
  ownerSocketId: string,
  cols?: number,
  rows?: number,
): TerminalSession | null {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    logWarn('terminal.session.attach.denied', { sessionId, userId, ownerSocketId });
    return null;
  }

  try {
    const ptyWithListeners = session.pty as IPty & { removeAllListeners?: () => void };
    ptyWithListeners.removeAllListeners?.();
  } catch {
    // Ignore listener cleanup failures and continue with a fresh PTY.
  }

  session.revision += 1;

  try {
    session.pty.kill();
  } catch {
    // The previous attach PTY may already be gone.
  }

  session.cwd = readTmuxCurrentPath(session.tmuxSession, session.cwd);
  session.ownerSocketId = ownerSocketId;
  session.pty = spawnAttachedPty(session.tmuxSession, session.cwd, cols, rows);

  logInfo('terminal.session.attach', {
    sessionId,
    userId,
    ownerSocketId,
    workspaceKey: session.workspaceKey,
    cwd: session.cwd,
    tmuxSession: session.tmuxSession,
  });

  return session;
}

export function getTerminalSessionSnapshot(sessionId: string, userId: string): string | null {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    logWarn('terminal.session.snapshot.denied', { sessionId, userId });
    return null;
  }

  return readTmuxSnapshot(session.tmuxSession);
}

export function getTerminalSession(sessionId: string): TerminalSession | null {
  return sessions.get(sessionId) ?? null;
}

export function resizeTerminalSession(sessionId: string, userId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    logWarn('terminal.session.resize.denied', { sessionId, userId, cols, rows });
    return false;
  }
  session.pty.resize(Math.max(20, cols), Math.max(8, rows));
  return true;
}

export function writeTerminalSession(sessionId: string, userId: string, data: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    logWarn('terminal.session.write.denied', { sessionId, userId, size: data.length });
    return false;
  }
  session.pty.write(data);
  return true;
}

export function navigateTerminalSession(sessionId: string, userId: string, action: TerminalNavigateAction): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    logWarn('terminal.session.navigate.denied', { sessionId, userId, action });
    return false;
  }

  try {
    switch (action) {
      case 'page_up':
        runTmuxQuiet(['copy-mode', '-t', session.tmuxSession]);
        runTmuxQuiet(['send-keys', '-t', session.tmuxSession, '-X', 'page-up']);
        break;
      case 'page_down':
        runTmuxQuiet(['copy-mode', '-t', session.tmuxSession]);
        runTmuxQuiet(['send-keys', '-t', session.tmuxSession, '-X', 'page-down']);
        break;
      case 'top':
        runTmuxQuiet(['copy-mode', '-t', session.tmuxSession]);
        runTmuxQuiet(['send-keys', '-t', session.tmuxSession, '-X', 'history-top']);
        break;
      case 'bottom':
        runTmuxQuiet(['send-keys', '-t', session.tmuxSession, '-X', 'cancel']);
        break;
    }
    return true;
  } catch {
    logWarn('terminal.session.navigate.failed', { sessionId, userId, action, tmuxSession: session.tmuxSession });
    return false;
  }
}

export function closeTerminalSession(sessionId: string, userId?: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (userId && session.userId !== userId) {
    logWarn('terminal.session.close.denied', { sessionId, userId });
    return false;
  }

  sessions.delete(sessionId);
  session.pty.kill();
  destroyTmuxSession(session.tmuxSession);
  logInfo('terminal.session.close', {
    sessionId,
    userId: session.userId,
    workspaceKey: session.workspaceKey,
    tmuxSession: session.tmuxSession,
  });
  return true;
}

export function closeTerminalSessionsByWorkspaceKey(workspaceKey: string, userId: string): string[] {
  const matching = Array.from(sessions.values()).filter(
    (session) => session.userId === userId && session.workspaceKey === workspaceKey,
  );

  if (!matching.length) {
    const tmuxSession = buildTmuxSessionName(userId, workspaceKey);
    if (tmuxSessionExists(tmuxSession)) {
      destroyTmuxSession(tmuxSession);
      logInfo('terminal.session.close.workspace.tmux_only', {
        userId,
        workspaceKey,
        tmuxSession,
      });
    }
    return [];
  }

  const closedSessionIds: string[] = [];
  const closedTmuxSessions = new Set<string>();

  for (const session of matching) {
    sessions.delete(session.id);
    try {
      session.pty.kill();
    } catch {
      // Ignore PTY kill failures during workspace shutdown.
    }

    if (!closedTmuxSessions.has(session.tmuxSession)) {
      destroyTmuxSession(session.tmuxSession);
      closedTmuxSessions.add(session.tmuxSession);
    }

    closedSessionIds.push(session.id);
    logInfo('terminal.session.close.workspace', {
      sessionId: session.id,
      userId,
      workspaceKey,
      tmuxSession: session.tmuxSession,
    });
  }

  return closedSessionIds;
}

export function detachTerminalSessionsForSocket(socketId: string): void {
  for (const [sessionId, session] of sessions.entries()) {
    if (session.ownerSocketId !== socketId) continue;
    sessions.delete(sessionId);
    try {
      const ptyWithListeners = session.pty as IPty & { removeAllListeners?: () => void };
      ptyWithListeners.removeAllListeners?.();
      session.pty.kill();
    } catch {
      // Ignore PTY teardown failures on socket disconnect.
    }
    logInfo('terminal.session.detach.socket', {
      sessionId,
      socketId,
      userId: session.userId,
      workspaceKey: session.workspaceKey,
      tmuxSession: session.tmuxSession,
    });
  }
}

export function hasTerminalWorkspaceSession(userId: string, workspaceKey: string): boolean {
  const activeSession = Array.from(sessions.values()).some(
    (session) => session.userId === userId && session.workspaceKey === workspaceKey,
  );

  if (activeSession) return true;

  return tmuxSessionExists(buildTmuxSessionName(userId, workspaceKey));
}
