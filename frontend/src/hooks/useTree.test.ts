import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTree } from './useTree';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    getTree: vi.fn(),
  },
}));

describe('useTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and sorts tree on mount', async () => {
    vi.mocked(api.getTree).mockResolvedValueOnce({
      pages: [
        { id: '2', parent_page_id: '1', title: 'Child B', slug: 'b', type: 'note', sort_order: 2, icon: null, created_at: '', updated_at: '' },
        { id: '1', parent_page_id: null, title: 'Root', slug: 'root', type: 'note', sort_order: 1, icon: null, created_at: '', updated_at: '' },
        { id: '3', parent_page_id: '1', title: 'Child A', slug: 'a', type: 'note', sort_order: 1, icon: null, created_at: '', updated_at: '' },
      ],
    } as any);

    const { result } = renderHook(() => useTree());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.tree).toHaveLength(1);
    expect(result.current.tree[0].children.map((c) => c.title)).toEqual(['Child A', 'Child B']);
  });

  it('sets error when loading fails and can refresh', async () => {
    vi.mocked(api.getTree)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ pages: [] } as any);

    const { result } = renderHook(() => useTree());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain('boom');

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.tree).toEqual([]);
  });
});
