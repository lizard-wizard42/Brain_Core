import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { PageSummary, TreePage } from '../types';

function buildTree(pages: PageSummary[]): TreePage[] {
  const pageMap = new Map<string, TreePage>();

  for (const p of pages) {
    pageMap.set(p.id, { ...p, children: [] });
  }

  const roots: TreePage[] = [];

  for (const p of pages) {
    const node = pageMap.get(p.id)!;
    if (p.parent_page_id && pageMap.has(p.parent_page_id)) {
      pageMap.get(p.parent_page_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sort = (nodes: TreePage[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
    for (const n of nodes) sort(n.children);
  };
  sort(roots);

  return roots;
}

export function useTree() {
  const [tree, setTree] = useState<TreePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const { pages } = await api.getTree();
      setTree(buildTree(pages));
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tree, loading, error, refresh };
}
