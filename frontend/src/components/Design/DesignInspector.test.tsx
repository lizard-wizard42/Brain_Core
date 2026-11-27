import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Editor, TLShapeId } from 'tldraw';
import { DesignInspector } from './DesignInspector';

afterEach(cleanup);

it('edits real frame position, dimensions and opacity, and exposes preview/export', () => {
  const shape = { id: 'shape:one', type: 'frame', x: 10, y: 20, rotation: 0, opacity: 1, props: { w: 1080, h: 1080, name: 'Post', color: 'black' } };
  const editor = { getShape: vi.fn(() => shape), updateShape: vi.fn(), getCurrentPageShapes: vi.fn(() => []), getSelectedShapeIds: vi.fn(() => ['shape:one']), getShapeGeometry: vi.fn(), updateShapes: vi.fn(), getInstanceState: vi.fn(() => ({ isGridMode: false })), updateInstanceState: vi.fn(), user: { getUserPreferences: vi.fn(() => ({ isSnapMode: false })), updateUserPreferences: vi.fn() } } as unknown as Editor;
  const preview = vi.fn(), exportPng = vi.fn();
  render(<DesignInspector editor={editor} selectedShapeId={'shape:one' as TLShapeId} onPreview={preview} onExport={exportPng} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'X' }), { target: { value: '42' } });
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ x: 42 }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Largura' }), { target: { value: '1200' } });
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ w: 1200 }) }));
  fireEvent.change(screen.getByRole('slider', { name: 'Opacidade' }), { target: { value: '50' } });
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.5 }));
  fireEvent.click(screen.getByRole('button', { name: 'Prévia' }));
  fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
  expect(preview).toHaveBeenCalledOnce(); expect(exportPng).toHaveBeenCalledOnce();
  expect(screen.queryByRole('group', { name: 'Sombra' })).not.toBeInTheDocument();
});

it('does not offer fill and border controls for a frame', () => {
  const shape = { id: 'shape:one', type: 'frame', x: 0, y: 0, rotation: 0, opacity: 1, props: { w: 100, h: 100, name: 'Frame', color: 'blue' } };
  const editor = { getShape: vi.fn(() => shape), updateShape: vi.fn(), getCurrentPageShapes: vi.fn(() => []), getSelectedShapeIds: vi.fn(() => ['shape:one']), getShapeGeometry: vi.fn(), updateShapes: vi.fn(), getInstanceState: vi.fn(() => ({ isGridMode: false })), updateInstanceState: vi.fn(), user: { getUserPreferences: vi.fn(() => ({ isSnapMode: false })), updateUserPreferences: vi.fn() } } as unknown as Editor;
  render(<DesignInspector editor={editor} selectedShapeId={'shape:one' as TLShapeId} onPreview={vi.fn()} onExport={vi.fn()} />);
  expect(screen.queryByRole('region', { name: 'Preenchimento' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Borda' })).not.toBeInTheDocument();
});

it('uses real canvas APIs for geometry, guides, and alignment', () => {
  const shape = { id: 'shape:one', type: 'geo', x: 0, y: 0, rotation: 0, opacity: 1, isLocked: false, props: { w: 100, h: 100, geo: 'rectangle', color: 'blue', fill: 'solid', dash: 'solid', size: 'm' } };
  const editor = { getShape: vi.fn(() => shape), updateShape: vi.fn(), getCurrentPageShapes: vi.fn(() => [shape]), getSelectedShapeIds: vi.fn(() => ['shape:one', 'shape:two']), alignShapes: vi.fn(), getShapeGeometry: vi.fn(), updateShapes: vi.fn(), getInstanceState: vi.fn(() => ({ isGridMode: false })), updateInstanceState: vi.fn(), user: { getUserPreferences: vi.fn(() => ({ isSnapMode: false })), updateUserPreferences: vi.fn() } } as unknown as Editor;
  render(<DesignInspector editor={editor} selectedShapeId={'shape:one' as TLShapeId} onPreview={vi.fn()} onExport={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Formato da forma'), { target: { value: 'ellipse' } });
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ geo: 'ellipse' }) }));
  fireEvent.click(screen.getByRole('button', { name: 'Esquerda' }));
  expect(editor.alignShapes).toHaveBeenCalledWith(['shape:one', 'shape:two'], 'left');
  fireEvent.click(screen.getByLabelText('Encaixar elementos'));
  expect(editor.user.updateUserPreferences).toHaveBeenCalledWith({ isSnapMode: true });
  fireEvent.click(screen.getByLabelText('Mostrar grade'));
  expect(editor.updateInstanceState).toHaveBeenCalledWith({ isGridMode: true });
});

it('edits a Design card fill, radius, shadow, blend, and filter properties', () => {
  const shape = { id: 'shape:card', type: 'design-card', x: 0, y: 0, rotation: 0, opacity: 1, isLocked: false,
    props: { w: 320, h: 240, text: '', textColor: '#111827', fontSize: 24, fill: '#ffffff', radius: 16,
      borderWidth: 1, borderColor: '#d9dde5', shadowX: 0, shadowY: 8, shadowBlur: 20,
      shadowColor: '#00000033', blendMode: 'normal', brightness: 100, contrast: 100, saturation: 100 } };
  const editor = { getShape: vi.fn(() => shape), updateShape: vi.fn(), getCurrentPageShapes: vi.fn(() => [shape]), getSelectedShapeIds: vi.fn(() => ['shape:card']), getInstanceState: vi.fn(() => ({ isGridMode: false })), user: { getUserPreferences: vi.fn(() => ({ isSnapMode: false })) } } as unknown as Editor;
  render(<DesignInspector editor={editor} selectedShapeId={'shape:card' as TLShapeId} onPreview={vi.fn()} onExport={vi.fn()} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Raio px' }), { target: { value: '32' } });
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ radius: 32 }) }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Desfoque px' }), { target: { value: '24' } });
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ shadowBlur: 24 }) }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Modo de mistura' }), { target: { value: 'multiply' } });
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ blendMode: 'multiply' }) }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Brilho %' }), { target: { value: '130' } });
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ brightness: 130 }) }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Cor de fundo' }), { target: { value: '#123456' } });
  fireEvent.blur(screen.getByRole('textbox', { name: 'Cor de fundo' }));
  expect(editor.updateShape).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ fill: '#123456' }) }));
});
