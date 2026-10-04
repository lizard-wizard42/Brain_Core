import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtPicker } from './AtPicker';
import type { PageSummary } from '../../types';

const page = (id: string, title: string, parent_page_id?: string): PageSummary => ({ id, title, parent_page_id, slug: id, type: 'note', sort_order: 0, updated_at: '2026-01-01T00:00:00Z' });
const pages = [page('a', 'Arquitetura'), page('b', 'Anotações', 'a'), page('c', 'Anotações')];
function show(query = '', source = pages, position = { top: 100, left: 100 }) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(<AtPicker pages={source} query={query} position={position} onSelect={onSelect} onClose={onClose} />);
  return { ...view, onSelect, onClose };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AtPicker', () => {
  it('shows no results, keeps Enter available to the editor, and closes on Escape', () => {
    const { onSelect, onClose } = show('missing');
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma página encontrada');
    expect(fireEvent.keyDown(document, { key: 'Enter' })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('explains an empty page collection', () => {
    show('', []);
    expect(screen.getByRole('status')).toHaveTextContent('Não há páginas disponíveis');
  });
  it('matches accents and distinguishes pages with the same title by their parent', () => {
    const { onSelect } = show('  ANOTACOES  ');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Anotações.*Arquitetura/ }));
    expect(onSelect).toHaveBeenCalledWith(pages[1]);
  });
  it('navigates results and resets selection when the query changes', () => {
    const { onSelect, onClose, rerender } = show();
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(pages[2]);
    rerender(<AtPicker pages={pages} query="arq" position={{ top: 100, left: 100 }} onSelect={onSelect} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(pages[0]);
  });
  it('does not consume composition or modifier shortcuts', () => {
    const { onSelect } = show();
    expect(fireEvent.keyDown(document, { key: 'Enter', isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('explains truncation and can select a page outside the initial eight by searching', () => {
    const source = Array.from({ length: 10 }, (_, n) => page(String(n), `Página ${n}`));
    const { onSelect, onClose, rerender } = show('', source);
    expect(screen.getAllByRole('button')).toHaveLength(8);
    expect(screen.getByText(/Mostrando 8 resultados/)).toBeInTheDocument();
    rerender(<AtPicker pages={source} query="Página 9" position={{ top: 100, left: 100 }} onSelect={onSelect} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(source[9]);
  });
  it('keeps the popup inside the viewport near the bottom-right edge', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 288, height: 300 } as DOMRect);
    show('', pages, { top: window.innerHeight - 5, left: window.innerWidth - 5 });
    const popup = screen.getByRole('region', { name: 'Referenciar página' });
    expect(popup).toHaveStyle({ left: `${window.innerWidth - 296}px`, top: `${window.innerHeight - 308}px` });
    fireEvent.mouseDown(document.body);
  });
});
