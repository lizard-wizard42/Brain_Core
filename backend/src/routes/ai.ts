import { Router } from 'express';
import { aiStatus, aiOrganizePage } from '../controllers/aiController';

const router = Router();

router.get('/status', aiStatus);
router.post('/pages/:id/organize', aiOrganizePage);

export default router;
