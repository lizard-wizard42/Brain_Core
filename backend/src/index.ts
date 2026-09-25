import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';

import { config } from './config/index';
import { ensureAppSchema } from './config/bootstrap';
import { ensureInitialAdmin } from './config/bootstrapAdmin';
import { seedDemoData } from './config/seedDemo';
import foldersRouter from './routes/folders';
import pagesRouter from './routes/pages';
import emojisRouter from './routes/emojis';
import rememberRouter from './routes/remember';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import aiRouter from './routes/ai';
import { AuthRequest, authMiddleware } from './middleware/auth';
import { perUserRateLimit } from './middleware/rateLimit';
import { registerSocketHandlers } from './services/socketService';
import { closeTerminalSession, closeTerminalSessionsByWorkspaceKey } from './services/terminalService';
import { deleteTerminalTab, listTerminalTabs, upsertTerminalTab } from './services/terminalTabsService';
import { startRememberReminderWorker } from './services/rememberReminderService';
import { startTrashRetentionWorker } from './services/trashRetentionService';
import { logError, logInfo } from './utils/logger';
import {
  isAllowedAttachmentUpload,
  isAllowedImageUpload,
  isAllowedStoredUploadPath,
  safeUploadExtension,
  discardInvalidUpload,
  ensureUploadStorageCapacity,
  validateUploadedFileContent,
} from './utils/uploadPolicy';

function normalizeTerminalTabTitle(value: string): string {
  const title = value.replace(/\s+/g, ' ').trim();
  const looksLikeEncodedMarkup = /(?:%[0-9a-f]{2}|<\/?svg\b|\b(?:viewbox|width|height|fill|stroke|rx)\s*=)/i.test(title);
  return !title || title.length > 80 || looksLikeEncodedMarkup ? 'Terminal' : title;
}

// ── Upload de imagens inline (editor) ──────────────────────────────────────
const UPLOADS_DIR = config.UPLOADS_DIR;
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${safeUploadExtension(file.originalname)}`);
  },
});

function normalizeOriginalName(name: string): string {
  if (!name) return 'arquivo';
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
  } catch {
    return name;
  }
}

const uploadImage = multer({
  storage: uploadStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, isAllowedImageUpload(file.originalname, file.mimetype));
  },
});

const MAX_ATTACHMENT_MB = 25;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

const uploadFile = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, isAllowedAttachmentUpload(file.originalname, file.mimetype));
  },
});

const allowedOrigins = [
  ...config.CORS_ORIGINS,
  ...(config.NODE_ENV === 'development' ? ['http://localhost:5173'] : []),
];

const app = express();
app.set('trust proxy', config.TRUSTED_PROXIES);
const httpServer = createServer(app);

const io = new SocketIO(httpServer, {
  maxHttpBufferSize: 1e7,
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Serve uploaded files — path relative to project root, not dist/
app.use('/uploads', authMiddleware, (req, res, next) => {
  if (!isAllowedStoredUploadPath(req.path)) {
    res.status(404).json({ error: 'Arquivo não encontrado' });
    return;
  }
  next();
}, express.static(UPLOADS_DIR, {
  dotfiles: 'deny',
  setHeaders: (res) => {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

app.use('/api/auth', authRouter);
app.use('/api/folders', authMiddleware, foldersRouter);
app.use('/api/pages', authMiddleware, pagesRouter);
app.use('/api/emojis', authMiddleware, emojisRouter);
app.use('/api/remember', authMiddleware, rememberRouter);
// AI calls a paid upstream on every request — cap per-user so a leaked session
// can't run up the bill. ~10/min sustained, burst 5.
app.use('/api/ai', authMiddleware, perUserRateLimit({ burst: 5, ratePerMin: 10 }), aiRouter);

// Uploads touch disk + CPU. The store also has a global capacity cap.
const uploadRateLimit = perUserRateLimit({ burst: 3, ratePerMin: 6 });

// Upload de imagem inline — retorna { url: '/uploads/filename.ext' }
app.post('/api/upload/image', authMiddleware, uploadRateLimit, ensureUploadStorageCapacity, uploadImage.single('image'), validateUploadedFileContent, (req, res) => {
  const authReq = req as AuthRequest;
  if (!req.file) { res.status(400).json({ error: 'Nenhum arquivo enviado' }); return; }
  const originalName = normalizeOriginalName(req.file.originalname);
  logInfo('attachment.image.upload', {
    fileName: originalName,
    mimeType: req.file.mimetype,
    size: req.file.size,
    storedUrl: `/uploads/${req.file.filename}`,
    userId: authReq.userId ?? null,
  });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Upload de arquivo para anexos (pdf/doc/xls/csv/etc)
app.post('/api/upload/file', authMiddleware, uploadRateLimit, ensureUploadStorageCapacity, (req, res) => {
  const authReq = req as AuthRequest;
  uploadFile.single('file')(req, res, async (err: unknown) => {
    if (err) {
      logError('attachment.file.upload.error', {
        detail: String(err),
        userId: authReq.userId ?? null,
      });
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: `Arquivo muito grande. Limite: ${MAX_ATTACHMENT_MB}MB` });
        return;
      }
      res.status(400).json({ error: 'Arquivo inválido. Envie PDF, Word, Excel, CSV, PowerPoint ou texto.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Arquivo inválido ou não enviado' });
      return;
    }
    if (await discardInvalidUpload(req.file)) {
      res.status(400).json({ error: 'Conteúdo do arquivo não corresponde ao formato informado' });
      return;
    }
    const originalName = normalizeOriginalName(req.file.originalname);

    logInfo('attachment.file.upload', {
      fileName: originalName,
      mimeType: req.file.mimetype,
      size: req.file.size,
      storedUrl: `/uploads/${req.file.filename}`,
      userId: authReq.userId ?? null,
    });
    res.json({
      url: `/uploads/${req.file.filename}`,
      name: originalName,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  });
});

if (config.TERMINAL_ENABLED) app.post('/api/terminal/close-many', authMiddleware, (req, res) => {
  const authReq = req as AuthRequest;
  const userId = authReq.userId;
  const sessionIds = Array.isArray(req.body?.sessionIds)
    ? req.body.sessionIds.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const closed = sessionIds.filter((sessionId: string) => closeTerminalSession(sessionId, userId));
  logInfo('terminal.session.close_many', {
    userId,
    requested: sessionIds.length,
    closed: closed.length,
  });
  res.json({ closed });
});

if (config.TERMINAL_ENABLED) app.get('/api/terminal/tabs', authMiddleware, async (req, res) => {
  const authReq = req as AuthRequest;
  const userId = authReq.userId;

  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const tabs = await listTerminalTabs(userId);
  res.json({ tabs });
});

if (config.TERMINAL_ENABLED) app.post('/api/terminal/tabs', authMiddleware, async (req, res) => {
  const authReq = req as AuthRequest;
  const userId = authReq.userId;
  const requestKey = typeof req.body?.requestKey === 'string' ? req.body.requestKey.trim() : '';
  const rawTitle = typeof req.body?.title === 'string' ? req.body.title : '';
  const title = normalizeTerminalTabTitle(rawTitle);
  const cwd = typeof req.body?.cwd === 'string' && req.body.cwd.trim() ? req.body.cwd.trim() : null;
  const isActive = req.body?.isActive === true;

  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  if (!requestKey) {
    res.status(400).json({ error: 'requestKey e title são obrigatórios' });
    return;
  }

  await upsertTerminalTab({ userId, requestKey, title, cwd, isActive });
  res.json({ ok: true });
});

if (config.TERMINAL_ENABLED) app.delete('/api/terminal/tabs/:requestKey', authMiddleware, async (req, res) => {
  const authReq = req as AuthRequest;
  const userId = authReq.userId;
  const requestKey = typeof req.params.requestKey === 'string' ? req.params.requestKey.trim() : '';

  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  if (!requestKey) {
    res.status(400).json({ error: 'requestKey inválido' });
    return;
  }

  const closedSessionIds = closeTerminalSessionsByWorkspaceKey(requestKey, userId);
  await deleteTerminalTab(userId, requestKey);

  logInfo('terminal.tab.delete', {
    userId,
    requestKey,
    closed: closedSessionIds.length,
  });

  res.json({ closed: closedSessionIds });
});

app.use('/api', healthRouter);

registerSocketHandlers(io, { terminalEnabled: config.TERMINAL_ENABLED });

async function startServer() {
  await ensureAppSchema();
  await ensureInitialAdmin();
  await seedDemoData();
  startRememberReminderWorker();
  startTrashRetentionWorker();
  httpServer.listen(config.PORT, config.HOST, () => {
    logInfo('server.start', {
      host: config.HOST,
      port: config.PORT,
      environment: config.NODE_ENV,
    });
  });
}

startServer().catch((err) => {
  logError('server.start.error', { detail: String(err) });
  process.exit(1);
});
