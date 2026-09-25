import { Router } from 'express';
import { getTree } from '../controllers/foldersController';

const router = Router();

router.get('/', getTree);

export default router;
