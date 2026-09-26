import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageHistoryPanel } from './PageHistoryPanel';
import type { PageVersion, TiptapDoc } from '../../types';

function doc(...blocks: string[]): TiptapDoc {
  return {
    type: 'doc',
    content: blocks.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

const nameById = new Map([['user-1', 'Pessoa Fictícia']]);

const versions: PageVersion[] = [
  {
    id: 'v2',
    page_id: 'p1',
    title: 'Planta',
    reason: 'content',
    content_hash: 'hash-2',
    created_at: '2026-09-25T13:00:00.000Z',
    author_user_id: 'user-1',
    content: doc('Sala', 'Cozinha'),
  },
  {
    id: 'v1',
    page_id: 'p1',
    title: 'Planta',
    reason: 'content',
    content_hash: 'hash-1',
    created_at: '2026-09-25T12:00:00.000Z',
    author_user_id: 'user-1',
    content: doc('Sala'),
  },
];

describe('PageHistoryPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows author, date and a readable diff summary', () => {
    render(<PageHistoryPanel versions={versions} nameById={nameById} onClose={vi.fn()} />);

    expect(screen.getByText(/Histórico \(2\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Pessoa Fictícia').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 trecho adicionado/)).toBeInTheDocument();
    expect(screen.getByText('Primeira versão registrada')).toBeInTheDocument();
  });

  it('opens a read-only preview of a previous version', () => {
    render(<PageHistoryPanel versions={versions} nameById={nameById} onClose={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Visualizar versão anterior' })[1]);

    const preview = screen.getByRole('dialog', { name: 'Visualização de versão anterior' });
    expect(preview).toHaveTextContent('Sala');
    expect(preview).toHaveTextContent('somente leitura');
  });

  it('explains when there is no history yet', () => {
    render(<PageHistoryPanel versions={[]} nameById={nameById} onClose={vi.fn()} />);
    expect(screen.getByText(/Sem versões registradas ainda/)).toBeInTheDocument();
  });

  it('shows a permission message when history is unavailable', () => {
    render(<PageHistoryPanel versions={[]} nameById={nameById} error="Histórico disponível apenas para o dono e para quem pode editar." onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('dono');
  });
});
