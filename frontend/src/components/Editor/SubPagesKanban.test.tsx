import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubPagesKanban } from './SubPagesKanban';
import { api } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: {
    getSubPages: vi.fn(),
    patchPage: vi.fn(),
  },
}));

describe('SubPagesKanban', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza as 4 colunas de status e as subpáginas', async () => {
    vi.mocked(api.getSubPages).mockResolvedValueOnce([
      { id: 'sub-1', title: 'Tarefa 1', status: 'todo', icon: '📝', due_date: null, tags: ['frontend'] },
      { id: 'sub-2', title: 'Tarefa 2', status: 'in_progress', icon: '⚡', due_date: null, tags: [] },
      { id: 'sub-3', title: 'Tarefa 3', status: 'done', icon: '✅', due_date: null, tags: [] },
      { id: 'sub-4', title: 'Nota solta', status: null, icon: '📄', due_date: null, tags: [] },
    ] as any);

    render(<SubPagesKanban pageId="parent-1" />);

    expect(await screen.findByText('A Fazer')).toBeInTheDocument();
    expect(screen.getByText('Em Andamento')).toBeInTheDocument();
    expect(screen.getByText('Concluído')).toBeInTheDocument();
    expect(screen.getByText('Sem Status')).toBeInTheDocument();

    expect(screen.getByText('Tarefa 1')).toBeInTheDocument();
    expect(screen.getByText('Tarefa 2')).toBeInTheDocument();
    expect(screen.getByText('Tarefa 3')).toBeInTheDocument();
    expect(screen.getByText('Nota solta')).toBeInTheDocument();
  });

  it('lida graciosamente com lista vazia', async () => {
    vi.mocked(api.getSubPages).mockResolvedValueOnce([]);

    render(<SubPagesKanban pageId="parent-empty" />);

    expect(await screen.findByText('0 subpáginas vinculadas')).toBeInTheDocument();
  });
});
