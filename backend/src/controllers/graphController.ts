import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { TiptapDoc, TiptapNode } from '../types';

export interface GraphNode {
  id: string;
  title: string;
  type: string;
  icon: string | null;
  status: string | null;
  tags: string[];
  val: number; // Node weight/size based on degree
}

export interface GraphLink {
  source: string;
  target: string;
  kind: 'parent' | 'reference';
}

function extractPageIdsFromContent(nodes: TiptapNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.type === 'subPageBlock' && typeof node.attrs?.pageId === 'string') {
      out.add(node.attrs.pageId);
    }
    if (node.marks?.length) {
      for (const mark of node.marks) {
        if (mark.type === 'link' && typeof mark.attrs?.href === 'string') {
          const match = mark.attrs.href.match(/page\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
          if (match?.[1]) out.add(match[1]);
        }
      }
    }
    if (node.content?.length) {
      extractPageIdsFromContent(node.content, out);
    }
  }
}

export async function getGraph(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  try {
    const pages = await query<{
      id: string;
      parent_page_id: string | null;
      title: string;
      type: string;
      icon: string | null;
      status: string | null;
      tags: string[];
      content: TiptapDoc | null;
    }>(
      `SELECT id, parent_page_id, title, type, icon, status, tags, content
       FROM pages
       WHERE owner_user_id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    const validPageIds = new Set(pages.map(p => p.id));
    const degreeMap = new Map<string, number>();
    for (const p of pages) degreeMap.set(p.id, 1); // Base weight

    const links: GraphLink[] = [];
    const linkSet = new Set<string>();

    for (const p of pages) {
      // 1. Parent-child link
      if (p.parent_page_id && validPageIds.has(p.parent_page_id)) {
        const key = `${p.parent_page_id}->${p.id}`;
        if (!linkSet.has(key)) {
          linkSet.add(key);
          links.push({ source: p.parent_page_id, target: p.id, kind: 'parent' });
          degreeMap.set(p.id, (degreeMap.get(p.id) || 1) + 1);
          degreeMap.set(p.parent_page_id, (degreeMap.get(p.parent_page_id) || 1) + 1);
        }
      }

      // 2. References inside Tiptap content
      if (p.content?.content) {
        const referenced = new Set<string>();
        extractPageIdsFromContent(p.content.content, referenced);
        for (const targetId of referenced) {
          if (validPageIds.has(targetId) && targetId !== p.id) {
            const key = `${p.id}->${targetId}`;
            if (!linkSet.has(key)) {
              linkSet.add(key);
              links.push({ source: p.id, target: targetId, kind: 'reference' });
              degreeMap.set(p.id, (degreeMap.get(p.id) || 1) + 1);
              degreeMap.set(targetId, (degreeMap.get(targetId) || 1) + 1);
            }
          }
        }
      }
    }

    const nodes: GraphNode[] = pages.map(p => ({
      id: p.id,
      title: p.title || 'Sem título',
      type: p.type,
      icon: p.icon,
      status: p.status,
      tags: p.tags || [],
      val: Math.min(10, degreeMap.get(p.id) || 1),
    }));

    res.json({ nodes, links });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch knowledge graph', detail: String(err) });
  }
}
