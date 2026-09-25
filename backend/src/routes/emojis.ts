import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { Router } from 'express';
import multer from 'multer';
import { createCustomEmoji, listCustomEmojis } from '../controllers/emojisController';
import { ensureUploadStorageCapacity, isAllowedPngUpload, validateUploadedFileContent } from '../utils/uploadPolicy';
import { perUserRateLimit } from '../middleware/rateLimit';

const router = Router();

const EMOJI_UPLOADS_DIR = path.join(config.UPLOADS_DIR, 'emojis');
fs.mkdirSync(EMOJI_UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: EMOJI_UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}.png`);
  },
});

const uploadEmoji = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, isAllowedPngUpload(file.originalname, file.mimetype));
  },
});
const emojiUploadRateLimit = perUserRateLimit({ burst: 5, ratePerMin: 10 });

router.get('/custom', listCustomEmojis);
router.post('/custom', emojiUploadRateLimit, ensureUploadStorageCapacity, uploadEmoji.single('emoji'), validateUploadedFileContent, createCustomEmoji);

export default router;
