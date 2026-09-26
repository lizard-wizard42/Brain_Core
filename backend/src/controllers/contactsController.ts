import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

export interface ContactPerson {
  id: string;
  name: string | null;
  email: string;
}

interface ContactListRow {
  contact_id: string;
  contact_name: string | null;
  contact_email: string;
  status: 'pending' | 'accepted';
  requested_by: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const listSql = `
  SELECT
    CASE WHEN c.requester_user_id = $1 THEN c.addressee_user_id ELSE c.requester_user_id END AS contact_id,
    CASE WHEN c.requester_user_id = $1 THEN u2.name ELSE u1.name END AS contact_name,
    CASE WHEN c.requester_user_id = $1 THEN u2.email ELSE u1.email END AS contact_email,
    c.status,
    c.requester_user_id AS requested_by
  FROM contacts c
  JOIN users u1 ON u1.id = c.requester_user_id
  JOIN users u2 ON u2.id = c.addressee_user_id
  WHERE c.requester_user_id = $1 OR c.addressee_user_id = $1`;

export async function listContacts(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const rows = await query<ContactListRow>(listSql, [req.userId]);
    const contacts: ContactPerson[] = [];
    const incoming: ContactPerson[] = [];
    const outgoing: ContactPerson[] = [];
    for (const row of rows) {
      const person = { id: row.contact_id, name: row.contact_name, email: row.contact_email };
      if (row.status === 'accepted') contacts.push(person);
      else if (row.requested_by === req.userId) outgoing.push(person);
      else incoming.push(person);
    }
    res.json({ contacts, incoming, outgoing });
  } catch {
    res.status(503).json({ error: 'Failed to list contacts' });
  }
}

export async function requestContact(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) { res.status(400).json({ error: 'Informe um e-mail válido.' }); return; }
  try {
    const target = await query<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [email]);
    if (!target.length) {
      res.status(404).json({ error: 'Não há conta cadastrada com este e-mail no Brain Core.' });
      return;
    }
    if (target[0].id === req.userId) {
      res.status(400).json({ error: 'Você não pode adicionar a si mesmo.' });
      return;
    }
    const existing = await query<{ status: string; requester_user_id: string }>(
      `SELECT status, requester_user_id FROM contacts
       WHERE (requester_user_id = $1 AND addressee_user_id = $2)
          OR (requester_user_id = $2 AND addressee_user_id = $1)`,
      [req.userId, target[0].id]);
    if (existing.length) {
      const message = existing[0].status === 'accepted'
        ? 'Vocês já são contatos.'
        : existing[0].requester_user_id === req.userId
          ? 'Você já enviou um pedido para esta pessoa.'
          : 'Esta pessoa já te enviou um pedido; aceite na lista de pedidos recebidos.';
      res.status(409).json({ error: message });
      return;
    }
    const created = await query<ContactPerson>(
      `INSERT INTO contacts (requester_user_id, addressee_user_id) VALUES ($1, $2)
       ON CONFLICT (requester_user_id, addressee_user_id) DO NOTHING
       RETURNING addressee_user_id AS id,
                 (SELECT name FROM users WHERE id = $2) AS name,
                 (SELECT email FROM users WHERE id = $2) AS email`,
      [req.userId, target[0].id]);
    if (!created.length) {
      res.status(409).json({ error: 'Você já enviou um pedido para esta pessoa.' });
      return;
    }
    res.status(201).json(created[0]);
  } catch {
    res.status(503).json({ error: 'Não foi possível enviar o pedido de contato' });
  }
}

export async function acceptContact(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const rows = await query(
      `UPDATE contacts SET status = 'accepted', updated_at = NOW()
       WHERE id = $1 AND addressee_user_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.id, req.userId]);
    if (!rows.length) { res.status(404).json({ error: 'Pedido não encontrado' }); return; }
    res.json({ accepted: true });
  } catch {
    res.status(503).json({ error: 'Não foi possível aceitar o pedido' });
  }
}

export async function removeContact(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const rows = await query(
      `DELETE FROM contacts WHERE id = $1 AND (requester_user_id = $2 OR addressee_user_id = $2) RETURNING id`,
      [req.params.id, req.userId]);
    if (!rows.length) { res.status(404).json({ error: 'Contato não encontrado' }); return; }
    res.json({ removed: true });
  } catch {
    res.status(503).json({ error: 'Não foi possível remover o contato' });
  }
}