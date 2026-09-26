import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { createCustomEmoji, listCustomEmojis } from '../controllers/emojisController';

const router = Router();

const EMOJI_UPLOADS_DIR = path.join(config.UPLOADS_DIR, 'emojis');
fs.mkdirSync(EMOJI_UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: EMOJI_UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const uploadEmoji = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, mime === 'image/png' || ext === '.png');
  },
});

router.get('/custom', listCustomEmojis);
router.post('/custom', uploadEmoji.single('emoji'), createCustomEmoji);

export default router;
