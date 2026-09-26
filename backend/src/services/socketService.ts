import { Server as SocketIO } from 'socket.io';
import { query } from '../config/database';
import { config } from '../config';
import { TiptapDoc } from '../types';
import { savePageRevision, pageRole, PageConflict, PageMissing } from './pageAccess';
import { authenticateAccessToken, extractAccessToken } from '../middleware/auth';
import { logError, logInfo, logWarn } from '../utils/logger';
import {
  attachTerminalSession,
  closeTerminalSession,
  detachTerminalSessionsForSocket,
  createTerminalSession,
  getTerminalSession,
  getTerminalSessionSnapshot,
  navigateTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from './terminalService';
import { deleteTerminalTab } from './terminalTabsService';

interface SavePayload {
  pageId: string;
  content: TiptapDoc;
  title: string;
  revision: number;
}

let pageIo: SocketIO | null = null;
export function notifyPageGrantChanged(pageId: string, userId: string): void {
  if (!pageIo) return;
  for (const socket of pageIo.sockets.sockets.values()) {
    if (socket.data.userId !== userId) continue;
    socket.leave(`page:${pageId}`);
    socket.emit('share:changed', { pageId });
  }
}

export function registerSocketHandlers(io: SocketIO): void {
  pageIo = io;
  io.use(async (socket, next) => {
    const rawToken = extractAccessToken(socket.handshake.headers);

    if (!rawToken) {
      next(new Error('Unauthorized'));
      return;
    }

    const payload = await authenticateAccessToken(rawToken);
    if (!payload) {
      next(new Error('Unauthorized'));
      return;
    }

    try {
      const rows = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [payload.sub]);
      if (!rows.length) { next(new Error('Unauthorized')); return; }
      socket.data.userId = payload.sub;
      socket.data.role = rows[0].role;
      next();
    } catch { next(new Error('Unavailable')); }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.data.userId || '');
    const canUseTerminal = config.TERMINAL_ENABLED && socket.data.role === 'owner';
    logInfo('socket.connect', { socketId: socket.id, userId });

    function denyTerminal(): boolean {
      if (canUseTerminal) return false;
      socket.emit('terminal:error', { message: 'Terminal disponível apenas ao proprietário do PC' });
      return true;
    }

    function bindTerminalSession(session: ReturnType<typeof createTerminalSession>): void {
      const boundRevision = session.revision;

      session.pty.onData((data) => {
        const current = getTerminalSession(session.id);
        if (!current || current.revision !== boundRevision) return;
        socket.emit('terminal:data', { sessionId: session.id, data });
      });

      session.pty.onExit(({ exitCode, signal }) => {
        const current = getTerminalSession(session.id);
        if (!current || current.revision !== boundRevision) return;
        closeTerminalSession(session.id);
        void deleteTerminalTab(session.userId, session.workspaceKey).catch(() => {});
        socket.emit('terminal:exit', { sessionId: session.id, exitCode, signal });
      });
    }

    socket.on('page:join', async (payload?: { pageId: string }) => {
      const pageId = payload?.pageId;
      if (typeof pageId !== 'string') return;
      try {
        if (await pageRole(pageId, userId)) socket.join(`page:${pageId}`);
        else socket.emit('page:error', { pageId, message: 'Page not found' });
      } catch { socket.emit('page:error', { pageId, message: 'Unavailable' }); }
    });

    socket.on('page:leave', ({ pageId }: { pageId: string }) => {
      socket.leave(`page:${pageId}`);
    });

    socket.on('page:save', async (payload: SavePayload) => {
      const { pageId, content, title, revision } = payload || {} as SavePayload;
      if (!pageId || !content) return;
      try {
        const row = await savePageRevision(pageId, userId, revision,
          { content, ...(title !== undefined ? { title } : {}) }, 'content');
        socket.emit('page:saved', { pageId, updated_at: row.updated_at, revision: row.revision });
        socket.to(`page:${pageId}`).emit('page:updated', {
          pageId, revision: row.revision, updated_at: row.updated_at,
        });
      } catch (error) {
        socket.emit('page:error', { pageId, message: error instanceof PageConflict ? 'Conflict' :
          error instanceof PageMissing ? 'Page not found' : 'Unavailable' });
      }
    });

    socket.on('terminal:create', ({
      cwd,
      cols,
      rows,
      workspaceKey,
    }: {
      cwd?: string | null;
      cols?: number;
      rows?: number;
      workspaceKey?: string;
    }) => {
      if (denyTerminal()) return;
      try {
        const session = createTerminalSession({
          ownerSocketId: socket.id,
          userId,
          workspaceKey: workspaceKey || `socket:${socket.id}`,
          requestedCwd: cwd,
          cols,
          rows,
        });

        bindTerminalSession(session);

        socket.emit('terminal:ready', {
          sessionId: session.id,
          cwd: session.cwd,
          workspaceKey: session.workspaceKey,
          snapshot: getTerminalSessionSnapshot(session.id, userId) ?? '',
        });
        logInfo('terminal.session.ready', {
          sessionId: session.id,
          socketId: socket.id,
          userId,
          cwd: session.cwd,
          workspaceKey: workspaceKey || `socket:${socket.id}`,
        });
      } catch (err) {
        logError('terminal.session.create.error', {
          detail: String(err),
          socketId: socket.id,
          userId,
          cwd: cwd ?? null,
          workspaceKey: workspaceKey || `socket:${socket.id}`,
        });
        socket.emit('terminal:error', {
          message: err instanceof Error ? err.message : 'Falha ao iniciar terminal',
        });
      }
    });

    socket.on('terminal:attach', ({
      sessionId,
      cols,
      rows,
    }: {
      sessionId: string;
      cols?: number;
      rows?: number;
    }) => {
      if (denyTerminal()) return;
      try {
        const session = attachTerminalSession(
          sessionId,
          userId,
          socket.id,
          cols,
          rows,
        );

        if (!session) {
          socket.emit('terminal:error', {
            sessionId,
            message: 'Sessão de terminal inválida',
          });
          return;
        }

        bindTerminalSession(session);
        socket.emit('terminal:ready', {
          sessionId: session.id,
          cwd: session.cwd,
          workspaceKey: session.workspaceKey,
          snapshot: getTerminalSessionSnapshot(session.id, userId) ?? '',
        });
      } catch (err) {
        logError('terminal.session.attach.error', {
          detail: String(err),
          socketId: socket.id,
          userId,
          sessionId,
        });
        socket.emit('terminal:error', {
          sessionId,
          message: err instanceof Error ? err.message : 'Falha ao reconectar terminal',
        });
      }
    });

    socket.on('terminal:input', ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (denyTerminal()) return;
      if (!sessionId || typeof data !== 'string') return;
      if (!writeTerminalSession(sessionId, userId, data)) {
        logWarn('terminal.session.write.invalid', { sessionId, socketId: socket.id, userId });
        socket.emit('terminal:error', { sessionId, message: 'Sessão de terminal inválida' });
      }
    });

    socket.on('terminal:resize', ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      if (denyTerminal()) return;
      if (!sessionId || !Number.isFinite(cols) || !Number.isFinite(rows)) return;
      if (!resizeTerminalSession(sessionId, userId, Math.round(cols), Math.round(rows))) {
        logWarn('terminal.session.resize.invalid', {
          sessionId,
          socketId: socket.id,
          userId,
          cols,
          rows,
        });
        socket.emit('terminal:error', { sessionId, message: 'Não foi possível redimensionar o terminal' });
      }
    });

    socket.on('terminal:close', ({ sessionId }: { sessionId: string }) => {
      if (denyTerminal()) return;
      if (!sessionId) return;
      logInfo('terminal.session.close.request', { sessionId, socketId: socket.id, userId });
      closeTerminalSession(sessionId, userId);
    });

    socket.on('terminal:navigate', ({ sessionId, action }: {
      sessionId: string;
      action: 'page_up' | 'page_down' | 'top' | 'bottom';
    }) => {
      if (denyTerminal()) return;
      if (!sessionId || !action) return;
      if (!navigateTerminalSession(sessionId, userId, action)) {
        socket.emit('terminal:error', { sessionId, message: 'Nao foi possivel navegar no historico do terminal' });
      }
    });

    socket.on('disconnect', () => {
      detachTerminalSessionsForSocket(socket.id);
      logInfo('socket.disconnect', { socketId: socket.id, userId });
    });
  });
}
