import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { uploadRateLimit } from '../middleware/uploadAdmission';
import { ensureUploadStorageCapacity, isAllowedPngUpload, validateUploadedFileContent } from '../utils/uploadPolicy';
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
    cb(null, isAllowedPngUpload(file.originalname, file.mimetype));
  },
});

router.get('/custom', listCustomEmojis);
router.post('/custom', uploadRateLimit, ensureUploadStorageCapacity, uploadEmoji.single('emoji'), validateUploadedFileContent, createCustomEmoji);

export default router;
