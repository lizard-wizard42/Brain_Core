import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { PageNavigation } from './PageNavigation';
import { api } from '../../api/client';
vi.mock('../../api/client', () => ({ api: { getPagePath: vi.fn(), getReferences: vi.fn() } }));
let editor: Editor | null = null;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getPagePath).mockResolvedValue([{ id: 'parent', title: 'Estudos' }, { id: 'page', title: 'Título salvo' }]);
  vi.mocked(api.getReferences).mockResolvedValue({ incoming: [], outgoing: [] });
});
afterEach(() => { cleanup(); editor?.destroy(); editor = null; });

it('uses the live title, navigates ancestors and loads incoming references on demand', async () => {
  const navigate = vi.fn();
  render(<PageNavigation pageId="page" title="Título editado" editor={null} onNavigate={navigate} />);
  const parent = await screen.findByRole('link', { name: 'Estudos' });
  expect(screen.getByText('Título editado')).toHaveAttribute('aria-current', 'page');
  expect(api.getReferences).not.toHaveBeenCalled();
  fireEvent.click(parent); expect(navigate).toHaveBeenCalledWith({ id: 'parent', title: 'Estudos' });
  fireEvent.click(screen.getByText('Páginas que citam esta'));
  expect(await screen.findByText(/Nenhuma referência recebida/)).toBeVisible();
  expect(api.getReferences).toHaveBeenCalledWith('page');
});

it('tracks heading edits and navigates duplicate headings by document position', async () => {
  editor = new Editor({ extensions: [StarterKit], content: '<h1>Introdução</h1><h2>Revisão</h2><h2>Revisão</h2>' });
  const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  render(<PageNavigation pageId="page" title="Nota" editor={editor} />);
  fireEvent.click(screen.getByText('Nesta página · 3'));
  const duplicates = screen.getAllByRole('button', { name: 'Revisão' });
  fireEvent.click(duplicates[1]);
  const selection = editor.state.selection.from;
  expect(editor.state.doc.resolve(selection).parent.textContent).toBe('Revisão');
  fireEvent.click(duplicates[0]); expect(editor.state.selection.from).toBeLessThan(selection);
  act(() => { editor!.commands.setContent('<h2>Novo título</h2>'); });
  expect(await screen.findByRole('button', { name: 'Novo título' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Introdução' })).not.toBeInTheDocument();
});

it('offers retry after reference failure without presenting a false empty state', async () => {
  vi.mocked(api.getReferences).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ incoming: [{ id: 'source', title: 'Fonte fictícia', slug: 'source', type: 'note', sort_order: 0, updated_at: '' }], outgoing: [] });
  render(<PageNavigation pageId="page" title="Nota" editor={null} />);
  fireEvent.click(screen.getByText('Páginas que citam esta'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
  expect(screen.queryByText(/Nenhuma referência recebida/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByRole('link', { name: 'Fonte fictícia' })).toHaveAttribute('href', '/page/source');
  await waitFor(() => expect(api.getReferences).toHaveBeenCalledTimes(2));
});
