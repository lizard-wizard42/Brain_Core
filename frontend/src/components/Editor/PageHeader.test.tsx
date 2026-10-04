import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageHeader } from './PageHeader';
import { api } from '../../api/client';
vi.mock('../../api/client', () => ({ api: { patchPage: vi.fn() } }));
vi.mock('../shared/EmojiPicker', () => ({ EmojiPicker: ({ onSelect }: { onSelect: (value: string) => void }) => <><button onClick={() => onSelect('🌙')}>Lua</button><button onClick={() => onSelect('')}>Remover ícone</button></> }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it('keeps the current icon after failed persistence and shows a recoverable error', async () => {
  vi.mocked(api.patchPage).mockRejectedValue(new Error('offline'));
  const update = vi.fn();
  render(<PageHeader pageId="fictional" title="Estudos" icon="📚" onIconChange={update} onTitleChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Trocar ícone' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lua' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar');
  expect(update).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Trocar ícone' })).toBeEnabled();
});

it('persists removal explicitly and refreshes only after success', async () => {
  vi.mocked(api.patchPage).mockResolvedValue({} as never);
  const update = vi.fn(), refresh = vi.fn();
  render(<PageHeader pageId="fictional" title="Estudos" icon="📚" onIconChange={update} onTitleChange={vi.fn()} onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Trocar ícone' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remover ícone' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(''));
  expect(api.patchPage).toHaveBeenCalledWith('fictional', { icon: '' }); expect(refresh).toHaveBeenCalledOnce();
});

it('makes the title and add-icon control available without hovering', () => {
  const update = vi.fn();
  render(<PageHeader pageId="fictional" title="Estudos" icon="" onIconChange={vi.fn()} onTitleChange={update} />);
  expect(screen.getByRole('button', { name: '+ ícone' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Título da página' }), { target: { value: 'Novo título' } });
  expect(update).toHaveBeenCalledWith('Novo título');
});
