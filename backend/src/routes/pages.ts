import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { ensureUploadStorageCapacity, isAllowedImageUpload, safeUploadExtension, validateUploadedFileContent } from '../utils/uploadPolicy';
import { perUserRateLimit } from '../middleware/rateLimit';
import {
  getPage,
  createPage,
  savePage,
  patchPage,
  deletePage,
  uploadCover,
  removeCover,
  getSubPages,
  getReferences,
  getPageVersions,
  restorePageVersion,
  snapshotPageVersion,
  getTrash,
  restorePage,
  permanentDeletePage,
  emptyTrash,
} from '../controllers/pagesController';

const UPLOADS_DIR = config.UPLOADS_DIR;

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${safeUploadExtension(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, isAllowedImageUpload(file.originalname, file.mimetype)),
});
const coverUploadRateLimit = perUserRateLimit({ burst: 5, ratePerMin: 10 });

const router = Router();

// Reject malformed ids early with 400 instead of letting Postgres throw a 500
// on `$1::uuid`. Applies to every route with :id / :versionId below.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function uuidParam(name: string) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void => {
    if (!UUID_RE.test(String(req.params[name]))) {
      res.status(400).json({ error: `invalid ${name}` });
      return;
    }
    next();
  };
}
router.param('id', (req, res, next) => uuidParam('id')(req, res, next));
router.param('versionId', (req, res, next) => uuidParam('versionId')(req, res, next));

// Trash routes — must come before /:id to avoid conflict
router.get('/trash', getTrash);
router.delete('/trash', emptyTrash);
router.post('/:id/restore', restorePage);
router.delete('/:id/permanent', permanentDeletePage);

router.get('/:id/subpages', getSubPages);
router.get('/:id/references', getReferences);
router.get('/:id/versions', getPageVersions);
router.post('/:id/versions/:versionId/restore', restorePageVersion);
router.post('/:id/versions', snapshotPageVersion);
router.get('/:id', getPage);
router.post('/', createPage);
router.put('/:id', savePage);
router.patch('/:id', patchPage);
router.delete('/:id', deletePage);
router.post('/:id/cover', coverUploadRateLimit, ensureUploadStorageCapacity, upload.single('cover'), validateUploadedFileContent, uploadCover);
router.delete('/:id/cover', removeCover);

export default router;
