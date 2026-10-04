import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NoteTemplatesDialog } from './NoteTemplatesDialog';
import { api } from '../../api/client';
import type { TiptapDoc } from '../../types';
vi.mock('../../api/client', () => ({ api: { listPageTemplates: vi.fn(), getPageTemplate: vi.fn(), savePageTemplate: vi.fn(), createPage: vi.fn() } }));
const content: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Exemplo fictício' }] }] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listPageTemplates).mockResolvedValue([]);
  vi.mocked(api.createPage).mockResolvedValue({ id: 'new-page' } as never);
});
afterEach(cleanup);
function setup() {
  const props = { pageId: 'source', title: 'Caderno', getCurrentContent: vi.fn(() => content), onClose: vi.fn(), onNavigate: vi.fn(), onRefresh: vi.fn() };
  render(<MemoryRouter><NoteTemplatesDialog {...props} /></MemoryRouter>);
  return props;
}
it.each([false, true])('creates an independent built-in note, as child=%s', async child => {
  const props = setup();
  fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'meeting' } });
  fireEvent.change(screen.getByLabelText('Título da nova página'), { target: { value: ' Reunião fictícia ' } });
  if (child) fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Criar página' }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ id: 'new-page' }));
  expect(api.createPage).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reunião fictícia', parent_page_id: child ? 'source' : null, content: expect.objectContaining({ type: 'doc' }) }));
  expect(JSON.stringify(vi.mocked(api.createPage).mock.calls[0][0].content)).toContain('Decisões');
  expect(props.getCurrentContent).not.toHaveBeenCalled(); expect(props.onRefresh).toHaveBeenCalledOnce();
});
it('saves the live snapshot, handles duplicate names, and uses the saved template for a new page', async () => {
  vi.mocked(api.savePageTemplate).mockRejectedValueOnce(new Error('Já existe um modelo com esse nome.')).mockResolvedValue({ id: 'custom', name: 'Meu estudo', created_at: '' });
  vi.mocked(api.getPageTemplate).mockResolvedValue({ id: 'custom', name: 'Meu estudo', created_at: '', content });
  const props = setup();
  fireEvent.click(screen.getByText('Salvar esta página como modelo'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar modelo' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Já existe');
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Meu estudo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }));
  await waitFor(() => expect(screen.getByLabelText('Modelo')).toHaveValue('custom'));
  expect(api.savePageTemplate).toHaveBeenLastCalledWith('Meu estudo', content);
  expect(api.createPage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Criar página' }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalled());
  expect(api.getPageTemplate).toHaveBeenCalledWith('custom');
  expect(api.createPage).toHaveBeenCalledWith(expect.objectContaining({ content }));
});
it('recovers list and create failures without closing or losing the requested title', async () => {
  vi.mocked(api.listPageTemplates).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
  vi.mocked(api.createPage).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 'new-page' } as never);
  const props = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Recarregar modelos' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Título da nova página'), { target: { value: 'Título preservado' } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar página' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível criar');
  expect(props.onClose).not.toHaveBeenCalled(); expect(screen.getByLabelText('Título da nova página')).toHaveValue('Título preservado');
  fireEvent.click(screen.getByRole('button', { name: 'Criar página' }));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
});
it('keeps keyboard focus in the dialog and restores it on close', async () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  setup();
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('button', { name: 'Criar página' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(screen.getByRole('combobox')).toHaveFocus();
  cleanup(); expect(trigger).toHaveFocus(); trigger.remove();
});
