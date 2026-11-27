import { Router, Response, raw } from 'express';
import { AuthRequest } from '../middleware/auth';
import { uploadRateLimit } from '../middleware/uploadAdmission';
import { storeDesignPreview, DesignPreviewError } from '../services/designPreview';

const router = Router();
router.post('/:id/design-preview', uploadRateLimit, raw({ type: 'image/png', limit: '3mb' }), async (req: AuthRequest, res: Response) => {
  try {
    const frameId = req.header('x-design-frame-id') || '';
    const revision = Number(req.header('x-design-revision'));
    if (!req.userId || !Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'PNG required' }); return; }
    await storeDesignPreview(req.userId, String(req.params.id), revision, frameId, req.body);
    res.status(204).end();
  } catch (error) {
    res.status(error instanceof DesignPreviewError ? error.status : 503).json({ error: error instanceof DesignPreviewError ? error.message : 'Preview unavailable' });
  }
});
export default router;
