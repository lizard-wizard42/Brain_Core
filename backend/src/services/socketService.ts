import { Server as SocketIO } from 'socket.io';
import { query } from '../config/database';
import { TiptapDoc } from '../types';
import { createVersionSnapshot, propagateSubPageBlockAttrs } from '../controllers/pagesController';
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
}

export function registerSocketHandlers(io: SocketIO, options: { terminalEnabled: boolean }): void {
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

    socket.data.userId = payload.sub;
    next();
  });

  io.on('connection', (socket) => {
    const userId = String(socket.data.userId || '');
    logInfo('socket.connect', { socketId: socket.id, userId });

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

    socket.on('page:join', ({ pageId }: { pageId: string }) => {
      socket.join(`page:${pageId}`);
    });

    socket.on('page:leave', ({ pageId }: { pageId: string }) => {
      socket.leave(`page:${pageId}`);
    });

    socket.on('page:save', async ({ pageId, content, title }: SavePayload) => {
      try {
        const currentRows = await query<{ updated_at: string; title: string; content: TiptapDoc }>(
          `SELECT updated_at, title, content
           FROM pages
           WHERE id = $1 AND deleted_at IS NULL`,
          [pageId]
        );
        if (!currentRows.length) {
          logWarn('socket.page.save.missing', { pageId, socketId: socket.id, userId });
          socket.emit('page:error', { pageId, message: 'Page not found' });
          return;
        }

        const current = currentRows[0];
        const nextTitle = title ?? current.title;
        const isUnchanged = current.title === nextTitle
          && JSON.stringify(current.content) === JSON.stringify(content);
        if (isUnchanged) {
          logInfo('socket.page.save.noop', { pageId, socketId: socket.id, userId });
          socket.emit('page:saved', { pageId, updated_at: current.updated_at });
          return;
        }

        const rows = await query<{ updated_at: string; title: string; content: TiptapDoc }>(
          `UPDATE pages
           SET content = $1, title = COALESCE($2, title)
           WHERE id = $3 AND deleted_at IS NULL
           RETURNING updated_at, title, content`,
          [JSON.stringify(content), title ?? null, pageId]
        );
        if (!rows.length) {
          logWarn('socket.page.save.missing', { pageId, socketId: socket.id, userId });
          socket.emit('page:error', { pageId, message: 'Page not found' });
          return;
        }
        logInfo('socket.page.save', { pageId, socketId: socket.id, userId });
        void createVersionSnapshot(pageId, title ? 'content+title' : 'content', {
          title: rows[0].title,
          content: rows[0].content,
        }).catch(() => {});
        socket.emit('page:saved', { pageId, updated_at: rows[0].updated_at });

        // Propagate title change to subPageBlocks referencing this page in other pages
        if (title) {
          propagateSubPageBlockAttrs(pageId, title, null).catch(() => {/* silent */});
        }
      } catch (err) {
        logError('socket.page.save.error', {
          detail: String(err),
          pageId,
          socketId: socket.id,
          userId,
        });
        socket.emit('page:error', { pageId, message: 'Failed to save' });
      }
    });

    if (options.terminalEnabled) socket.on('terminal:create', ({
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

    if (options.terminalEnabled) socket.on('terminal:attach', ({
      sessionId,
      cols,
      rows,
    }: {
      sessionId: string;
      cols?: number;
      rows?: number;
    }) => {
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

    if (options.terminalEnabled) socket.on('terminal:input', ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (!sessionId || typeof data !== 'string') return;
      if (!writeTerminalSession(sessionId, userId, data)) {
        logWarn('terminal.session.write.invalid', { sessionId, socketId: socket.id, userId });
        socket.emit('terminal:error', { sessionId, message: 'Sessão de terminal inválida' });
      }
    });

    if (options.terminalEnabled) socket.on('terminal:resize', ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
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

    if (options.terminalEnabled) socket.on('terminal:close', ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      logInfo('terminal.session.close.request', { sessionId, socketId: socket.id, userId });
      closeTerminalSession(sessionId, userId);
    });

    if (options.terminalEnabled) socket.on('terminal:navigate', ({ sessionId, action }: {
      sessionId: string;
      action: 'page_up' | 'page_down' | 'top' | 'bottom';
    }) => {
      if (!sessionId || !action) return;
      if (!navigateTerminalSession(sessionId, userId, action)) {
        socket.emit('terminal:error', { sessionId, message: 'Nao foi possivel navegar no historico do terminal' });
      }
    });

    socket.on('disconnect', () => {
      if (options.terminalEnabled) detachTerminalSessionsForSocket(socket.id);
      logInfo('socket.disconnect', { socketId: socket.id, userId });
    });
  });
}
