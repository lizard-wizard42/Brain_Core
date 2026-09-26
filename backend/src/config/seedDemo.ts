import { config } from './index';
import { query } from './database';
import { logInfo } from '../utils/logger';

interface PageId { id: string }

export async function seedDemoData(): Promise<void> {
  if (!config.SEED_DEMO_DATA) return;

  const owners = await query<{ id: string }>("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
  if (!owners.length) return;
  const ownerId = owners[0].id;
  const existing = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM pages');
  if (Number(existing[0]?.count || 0) > 0) return;

  const welcome = await query<PageId>(
    `INSERT INTO pages (title, slug, type, icon, is_section, content, sort_order, tags, owner_user_id)
     VALUES ($1, $2, 'note', $3, TRUE, $4, 0, $5, $6)
     RETURNING id`,
    [
      'Comece aqui', 'comece-aqui', '✨',
      JSON.stringify({ type: 'doc', content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Bem-vindo ao Brain Core' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Este conteúdo é uma demonstração local. Você pode editar ou apagar tudo sem afetar serviços externos.' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Organize ideias em páginas e subpáginas.' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use tags e datas para acompanhar prioridades.' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mantenha seus dados neste computador.' }] }] },
        ] },
      ] }),
      ['demo', 'início'], ownerId,
    ],
  );

  await query(
    `INSERT INTO pages (parent_page_id, title, slug, type, icon, content, sort_order, status, due_date, tags, owner_user_id)
     VALUES ($1, $2, $3, 'note', $4, $5, 0, 'em andamento', CURRENT_DATE + INTERVAL '7 days', $6, $7)`,
    [
      welcome[0].id, 'Planejamento da semana', 'planejamento-da-semana', '🗓️',
      JSON.stringify({ type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Exemplo fictício de planejamento. Troque este texto pelas suas próximas ações.' }] },
      ] }),
      ['demo', 'planejamento'], ownerId,
    ],
  );

  await query(
    `INSERT INTO pages (title, slug, type, icon, content, sort_order, tags, owner_user_id)
     VALUES ($1, $2, 'infinite', $3, $4, 1, $5, $6)`,
    ['Mapa visual', 'mapa-visual', '🧠', JSON.stringify({ tldraw: true, version: 1, data: null }), ['demo', 'visual'], ownerId],
  );

  logInfo('demo.seed.completed', { pages: 3 });
}
