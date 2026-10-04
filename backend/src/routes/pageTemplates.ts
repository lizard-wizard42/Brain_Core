import { Router, Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { validDocument } from '../services/noteDocument';
import type { TiptapDoc, TiptapNode } from '../types';

// Templates reuse text and structure, not live attachments or child-page cards.
function templateContent(document: TiptapDoc): TiptapDoc {
  function clean(node: TiptapNode): TiptapNode | null {
    if (['image', 'attachmentBlock', 'subPageBlock'].includes(node.type)) return null;
    const copy = { ...node };
    if (copy.content) copy.content = copy.content.map(clean).filter((item): item is TiptapNode => item !== null);
    if (copy.type === 'taskItem') copy.attrs = { ...copy.attrs, checked: false };
    if (['doc', 'blockquote', 'listItem', 'taskItem', 'tableCell', 'tableHeader'].includes(copy.type) && !copy.content?.length) copy.content = [{ type: 'paragraph' }];
    return copy;
  }
  return clean(document) as TiptapDoc;
}

const router = Router();
router.get('/', async (req: AuthRequest, res: Response) => {
  try { res.json(await query('SELECT id, name, created_at FROM page_templates WHERE user_id=$1 ORDER BY name, id', [req.userId])); }
  catch { res.status(503).json({ error: 'Não foi possível carregar seus modelos' }); }
});
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { res.status(404).json({ error: 'Modelo não encontrado' }); return; }
  try {
    const rows = await query('SELECT id, name, content, created_at FROM page_templates WHERE id=$1 AND user_id=$2', [id, req.userId]);
    if (!rows.length) { res.status(404).json({ error: 'Modelo não encontrado' }); return; }
    res.json(rows[0]);
  } catch { res.status(503).json({ error: 'Não foi possível carregar o modelo' }); }
});
router.post('/', async (req: AuthRequest, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 80 || !validDocument(req.body?.content)) { res.status(400).json({ error: 'Informe um nome de até 80 caracteres e um documento válido de até 256 KB' }); return; }
  try {
    const rows = await query(`INSERT INTO page_templates(user_id,name,content) VALUES ($1,$2,$3)
      ON CONFLICT (user_id,name) DO NOTHING RETURNING id,name,created_at`, [req.userId, name, JSON.stringify(templateContent(req.body.content))]);
    if (!rows.length) { res.status(409).json({ error: 'Já existe um modelo com esse nome. Escolha outro nome.' }); return; }
    res.status(201).json(rows[0]);
  } catch { res.status(503).json({ error: 'Não foi possível salvar o modelo' }); }
});
export default router;
