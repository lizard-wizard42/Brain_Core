import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { acceptContact, listContacts, removeContact, requestContact } from '../controllers/contactsController';

const router = Router();

router.get('/', (req: AuthRequest, res: Response) => void listContacts(req, res));
router.post('/', (req: AuthRequest, res: Response) => void requestContact(req, res));
router.post('/:id/accept', (req: AuthRequest, res: Response) => void acceptContact(req, res));
router.delete('/:id', (req: AuthRequest, res: Response) => void removeContact(req, res));

export default router;