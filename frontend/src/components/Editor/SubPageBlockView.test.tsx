import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubPageBlockView } from './SubPageBlockView';
import { api } from '../../api/client';
import { writePageDrag, clearPageDrag } from './pageDrag';

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/client', () => ({ api: { deletePage: vi.fn(), renamePage: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function show(source?: 'child' | 'reference') {
  const callbacks = { deleteNode: vi.fn(), updateAttributes: vi.fn(), onRefresh: vi.fn(), onNavigatePage: vi.fn() };
  const props = { node: { attrs: { pageId: 'synthetic-page', title: 'Página de exemplo', icon: '', source } }, ...callbacks };
  render(<SubPageBlockView {...props as unknown as ComponentProps<typeof SubPageBlockView>} />);
  return callbacks;
}
function openTrashDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Mover página para a lixeira' }));
  return screen.getByRole('dialog');
}

describe('subpage and reference actions', () => {
  it('removes only the reference, without deleting or refreshing the target page', () => {
    const actions = show('reference');
    expect(screen.getByText('Referência')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }));
    expect(actions.deleteNode).toHaveBeenCalledOnce();
    expect(api.deletePage).not.toHaveBeenCalled();
    expect(actions.onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['child', undefined] as const)('waits for successful deletion of a %s page before removing its block', async source => {
    let complete!: () => void;
    vi.mocked(api.deletePage).mockImplementation(() => new Promise(resolve => { complete = () => resolve({ deleted: true }); }));
    const actions = show(source);
    const dialog = openTrashDialog();
    expect(within(dialog).getByText(/poderá restaurar/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover para a lixeira' }));
    expect(actions.deleteNode).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Movendo…' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => complete());
    expect(api.deletePage).toHaveBeenCalledTimes(1);
    expect(actions.deleteNode).toHaveBeenCalledOnce();
    expect(actions.onRefresh).toHaveBeenCalledOnce();
  });

  it.each(['API 500', 'API 403', 'API 404'])('preserves the block after %s and supports retry', async message => {
    vi.mocked(api.deletePage).mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce({ deleted: true });
    const actions = show();
    const dialog = openTrashDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover para a lixeira' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível mover');
    expect(actions.deleteNode).not.toHaveBeenCalled();
    expect(actions.onRefresh).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover para a lixeira' }));
    await waitFor(() => expect(actions.deleteNode).toHaveBeenCalledOnce());
  });

  it('focuses cancel, contains keyboard focus, and restores focus on Escape', () => {
    show();
    const trigger = screen.getByRole('button', { name: 'Mover página para a lixeira' });
    trigger.focus();
    const dialog = openTrashDialog();
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    const confirm = within(dialog).getByRole('button', { name: 'Mover para a lixeira' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(api.deletePage).not.toHaveBeenCalled();
  });

  it('keeps the entered name after a rename failure and saves it on retry', async () => {
    vi.mocked(api.renamePage).mockRejectedValueOnce(new Error('API 500')).mockResolvedValueOnce({} as never);
    const actions = show();
    fireEvent.click(screen.getByRole('button', { name: 'Renomear página' }));
    const input = screen.getByRole('textbox', { name: 'Nome da página' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Novo nome' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível renomear');
    expect(input).toHaveValue('Novo nome');
    expect(actions.deleteNode).not.toHaveBeenCalled();
    expect(actions.updateAttributes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(actions.updateAttributes).toHaveBeenCalledWith({ title: 'Novo nome' }));
    expect(screen.getByRole('button', { name: 'Renomear página' })).toHaveFocus();
  });

  it('cancels rename without a request and exposes a focusable page action', () => {
    const actions = show();
    expect(screen.queryByText('Subpágina')).not.toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Abrir subpágina: Página de exemplo' });
    open.focus();
    expect(open).toHaveFocus();
    fireEvent.click(open);
    expect(actions.onNavigatePage).toHaveBeenLastCalledWith({ id: 'synthetic-page', title: 'Página de exemplo', icon: '' }, false);
    fireEvent.click(open, { ctrlKey: true });
    expect(actions.onNavigatePage).toHaveBeenLastCalledWith({ id: 'synthetic-page', title: 'Página de exemplo', icon: '' }, true);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear página' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Descartar' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(api.renamePage).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

function showDropTarget(source: 'child' | 'reference' = 'child', editable = true) {
  const onNestPage = vi.fn().mockResolvedValue(undefined);
  const props = { node: { attrs: { pageId: 'beta', title: 'Beta', icon: '', source } }, editor: { isEditable: editable, view: { dragging: null } }, updateAttributes: vi.fn(), deleteNode: vi.fn(), onNestPage };
  const view = render(<SubPageBlockView {...props as unknown as ComponentProps<typeof SubPageBlockView>} />);
  const target = view.container.querySelector('[data-page-card]') as HTMLElement;
  if (target) vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 80, bottom: 180 } as DOMRect);
  return { onNestPage, target };
}
function dropEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, clientY: { value: clientY } });
  fireEvent(target, event);
}
function syntheticDrag(reference = false, id = 'alpha') {
  const data = new Map<string,string>();
  const dt = { setData: (k:string,v:string) => data.set(k,v), getData: (k:string) => data.get(k) ?? '', get types() { return [...data.keys()]; }, effectAllowed: '', dropEffect: '' } as unknown as DataTransfer;
  writePageDrag(dt, { id, title: id, origin: 'editor', reference });
  return dt;
}
describe('Page card nesting target', () => {
  afterEach(clearPageDrag);
  it('moves a real page only when dropped in the center, and preserves it on failure', async () => {
    const { target, onNestPage } = showDropTarget(); const dataTransfer=syntheticDrag();
    expect(target).not.toBeNull();
    onNestPage.mockRejectedValueOnce(new Error('Could not move fictional page'));
    dropEvent(target, 'dragover', dataTransfer, 140);
    expect(screen.getByText('Mover para dentro de Beta')).toBeVisible();
    dropEvent(target, 'drop', dataTransfer, 140);
    await waitFor(() => expect(onNestPage).toHaveBeenCalledWith('alpha', 'beta'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not move fictional page');
    expect(screen.getByRole('button', { name: 'Abrir subpágina: Beta' })).toBeInTheDocument();
  });
  it.each(['edge', 'self', 'reference', 'readonly'] as const)('does not reparent on %s drops', async kind => {
    const { target, onNestPage } = showDropTarget('child', kind !== 'readonly');
    const dataTransfer = syntheticDrag(kind === 'reference', kind === 'self' ? 'beta' : 'alpha');
    expect(target).not.toBeNull();
    dropEvent(target, 'drop', dataTransfer, kind === 'edge' ? 102 : 140);
    expect(onNestPage).not.toHaveBeenCalled();
  });
});
