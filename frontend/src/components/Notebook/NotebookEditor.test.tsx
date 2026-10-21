import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookEditor } from './NotebookEditor';
import { newNotebook } from './notebookModel';
import type { Page } from '../../types';

vi.mock('../../api/client', () => ({ api: { patchPage: vi.fn().mockResolvedValue({ revision: 2 }) }, isRevisionConflict: () => false }));
vi.mock('../../api/browserSession', () => ({ activeBrowserUserId: () => 'test-account' }));
vi.mock('./notebookDrafts', () => ({ notebookDrafts: { read: vi.fn().mockResolvedValue(undefined), write: vi.fn().mockResolvedValue('ok'), remove: vi.fn().mockResolvedValue(undefined) } }));

const page = (): Page => ({ id: 'synthetic-page', title: 'Estudo', slug: 'estudo', revision: 1, type: 'notebook', content: newNotebook(), sort_order: 0, updated_at: '' });
const phone = (matches: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({
  matches: matches && query.includes('max-width: 550px'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
const open = async () => { render(<NotebookEditor page={page()} />); await screen.findByRole('toolbar'); await waitFor(() => expect((screen.getByRole('textbox', { name: 'Título do caderno' }) as HTMLInputElement).disabled).toBe(false)); };
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Notebook editor layout', () => {
  it('on a phone keeps the essential tools and moves the rest to a "more" popover', async () => {
    phone(true); await open();
    const toolbar = screen.getByRole('toolbar');
    for (const name of ['Desfazer', 'Refazer', 'Caneta', 'Marca-texto', 'Borracha', 'Selecionar', 'Texto']) expect(within(toolbar).getByRole('button', { name })).toBeTruthy();
    expect(within(toolbar).queryByRole('button', { name: 'Mover folha' })).toBeNull();
    expect(within(toolbar).queryByRole('button', { name: 'Papel' })).toBeNull();
    const more = within(toolbar).getByRole('button', { name: 'Mais ferramentas' });
    expect(more.getAttribute('aria-haspopup')).toBe('true'); expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('group', { name: 'Mais ferramentas' });
    expect(within(panel).getByRole('button', { name: /Mover folha/ })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: /Papel/ })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Desenhar com dedo' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(panel).getByRole('status').textContent).toContain('Passe a caneta');
    fireEvent.click(within(panel).getByRole('button', { name: 'Desenhar com dedo' }));
    expect(within(panel).getByRole('button', { name: 'Desenhar com dedo' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('closes the popover with Escape and with a press outside', async () => {
    phone(true); await open();
    const more = screen.getByRole('button', { name: 'Mais ferramentas' });
    fireEvent.click(more); expect(screen.getByRole('group', { name: 'Mais ferramentas' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Mais ferramentas' })).toBeNull();
    fireEvent.click(more); fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Mais ferramentas' })).toBeNull();
  });
  it('on a phone offers stroke width in a popover and puts add-sheet in the footer popover', async () => {
    phone(true); await open();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Espessura do traço' }));
    fireEvent.click(screen.getByRole('button', { name: '4 px' }));
    expect(screen.queryByRole('group', { name: 'Espessura do traço' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar folha' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar folha' }));
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Diminuir zoom' })).toBeTruthy();
  });
  it('keeps the full desktop controls on wide screens', async () => {
    phone(false); await open();
    expect(screen.getByRole('button', { name: 'Mover folha' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Desenhar com dedo/ })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Espessura do traço' })).toBeTruthy();
    expect(screen.getByText('Passe a caneta sobre a folha para testar')).toBeTruthy();
  });
  it('disables colors while the eraser is selected', async () => {
    phone(false); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Borracha' }));
    expect((screen.getByRole('button', { name: 'Azul' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Texto' }));
    expect((screen.getByRole('button', { name: 'Azul' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Notebook editor shortcuts and focus mode', () => {
  it('zooms with Ctrl+=, Ctrl+- and fits with Ctrl+0', async () => {
    phone(false); await open();
    const readout = () => screen.getByRole('button', { name: 'Ajustar folha à largura' }).textContent;
    const fitted = readout();
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    const bigger = Number.parseInt(readout()!);
    expect(bigger).toBeGreaterThan(Number.parseInt(fitted!));
    fireEvent.keyDown(window, { key: '-', ctrlKey: true }); fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    expect(Number.parseInt(readout()!)).toBeLessThan(bigger);
    fireEvent.keyDown(window, { key: '0', ctrlKey: true });
    expect(readout()).toBe(fitted);
  });
  it('multiplies the zoom with the footer buttons', async () => {
    phone(false); await open();
    expect(screen.getByRole('button', { name: 'Ajustar folha à largura' }).textContent).toBe('25%');
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' })); fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    // jsdom has no layout, so the automatic fit is the 25% minimum; two steps of x1.2 give 36%.
    expect(screen.getByRole('button', { name: 'Ajustar folha à largura' }).textContent).toBe('36%');
  });
  it('hides every bar in focus mode and comes back with the exit button, F or Escape', async () => {
    phone(false); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    fireEvent.click(screen.getByRole('button', { name: 'Modo foco' }));
    expect(screen.queryByRole('toolbar')).toBeNull(); expect(screen.queryByRole('contentinfo')).toBeNull(); expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sair do modo foco' }));
    expect(screen.getByRole('toolbar')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'f' }); expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.getByRole('toolbar')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'f' }); fireEvent.keyDown(window, { key: 'f' }); expect(screen.getByRole('toolbar')).toBeTruthy();
  });
  it('does not toggle focus mode while typing the title', async () => {
    phone(false); await open();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Título do caderno' }), { key: 'f' });
    expect(screen.getByRole('toolbar')).toBeTruthy();
  });
  it('undoes and redoes with Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z', async () => {
    phone(false); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar folha' }));
    expect(screen.getByText('2 / 2')).toBeTruthy();
    const section = screen.getByRole('region', { name: 'Caderno' });
    fireEvent.keyDown(section, { key: 'z', ctrlKey: true });
    expect(screen.getByText('1 / 1')).toBeTruthy();
    fireEvent.keyDown(section, { key: 'y', ctrlKey: true });
    expect(screen.getByText('2 / 2')).toBeTruthy();
    fireEvent.keyDown(section, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(section, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('2 / 2')).toBeTruthy();
    await act(async () => {});
  });
});
