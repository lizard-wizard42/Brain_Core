import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'tldraw';
import { DesignOutline } from './DesignOutline';
afterEach(cleanup);

function fakeEditor() {
  const pages = [{ id: 'page:one', name: 'Feed' }];
  let current = 'page:one';
  const shapes = [
    { id: 'shape:frame', type: 'frame', parentId: 'page:one', index: 'a1', props: { name: 'Post 01', w: 1080, h: 1080 } },
    { id: 'shape:text', type: 'text', parentId: 'shape:frame', index: 'a1', props: {} },
  ];
  const api = {
    getPages: vi.fn(() => pages), getCurrentPageId: vi.fn(() => current), getCurrentPageShapes: vi.fn(() => shapes),
    setCurrentPage: vi.fn((id: string) => { current = id; }),
    createPage: vi.fn(({ name }: { name: string }) => { pages.push({ id: 'page:two', name }); }),
    renamePage: vi.fn((id: string, name: string) => { const page = pages.find(item => item.id === id); if (page) page.name = name; }),
    select: vi.fn(), zoomToSelection: vi.fn(), setCurrentTool: vi.fn(),
    store: { listen: vi.fn(() => () => {}) },
  };
  return api;
}

describe('DesignOutline', () => {
  it('lists artboards and their nested layers and selects them', async () => {
    const editor = fakeEditor();
    render(<DesignOutline editor={editor as unknown as Editor} />);
    expect(await screen.findByRole('button', { name: 'Camada: Post 01' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Camada: Texto' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Camada: Post 01' }));
    expect(editor.select).toHaveBeenCalledWith('shape:frame');
    expect(editor.zoomToSelection).toHaveBeenCalled();
  });

  it('creates and renames canvas pages without changing existing Infinite pages', async () => {
    const editor = fakeEditor();
    render(<DesignOutline editor={editor as unknown as Editor} />);
    await screen.findByRole('button', { name: 'Renomear Feed' });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar página de Design' }));
    expect(editor.createPage).toHaveBeenCalledWith({ name: 'Página 2' });
    expect(editor.setCurrentPage).toHaveBeenCalledWith('page:two');
    fireEvent.click(screen.getByRole('button', { name: 'Renomear Página 2' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da página de Design' }), { target: { value: 'Calendário' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nome da página de Design' }), { key: 'Enter' });
    expect(editor.renamePage).toHaveBeenCalledWith('page:two', 'Calendário');
  });

  it('activates canvas tools through the editor', () => {
    const editor = fakeEditor();
    render(<DesignOutline editor={editor as unknown as Editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Texto' }));
    expect(editor.setCurrentTool).toHaveBeenCalledWith('text');
  });
});
