import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FindReplacePopover } from './Editor';

function fakeEditor(text: string) {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  const editor: any = {
    state: {
      selection: { from: 0, to: 0 },
      doc: {
        descendants(fn: (node: any, pos: number) => void) {
          fn({ isText: true, text }, 0);
        },
        textBetween: () => '',
      },
      tr: { insertText: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
    },
    view: { dispatch: vi.fn(), domAtPos: () => ({ node: undefined }) },
    on: vi.fn((evt: string, cb: (...a: any[]) => void) => {
      (listeners[evt] ??= []).push(cb);
    }),
    off: vi.fn((evt: string, cb: (...a: any[]) => void) => {
      listeners[evt] = (listeners[evt] ?? []).filter((f) => f !== cb);
    }),
    __emit(evt: string) {
      (listeners[evt] ?? []).forEach((f) => f());
    },
  };
  const run = vi.fn(() => { editor.__emit('transaction'); });
  const setTextSelection = vi.fn((sel: { from: number; to: number }) => {
    editor.state.selection = { ...sel };
    return { run };
  });
  const focus = vi.fn(() => ({ setTextSelection, run }));
  editor.chain = vi.fn(() => ({ focus }));
  editor.__setTextSelection = setTextSelection;
  return editor;
}

describe('FindReplacePopover', () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ''; });

  it('permanece aberto após clique no botão disparador (data-find-toggle)', () => {
    const onClose = vi.fn();
    render(
      <div>
        <button data-find-toggle>abrir</button>
        <FindReplacePopover editor={fakeEditor('alpha beta alpha')} onClose={onClose} />
      </div>,
    );
    // simula o mousedown global que o handleOutside escuta
    fireEvent.mouseDown(screen.getByText('abrir'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('conta ocorrências do termo digitado', () => {
    render(<FindReplacePopover editor={fakeEditor('alpha beta alpha')} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'alpha' } });
    expect(screen.getByText('2 ocorrências')).toBeInTheDocument();
  });

  it('recomputa as decorações ao digitar o termo (dispatch de meta)', () => {
    const editor = fakeEditor('alpha beta alpha');
    render(<FindReplacePopover editor={editor} onClose={vi.fn()} />);
    editor.view.dispatch.mockClear();
    editor.state.tr.setMeta.mockClear();
    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'alpha' } });
    expect(editor.state.tr.setMeta).toHaveBeenCalled();
    expect(editor.view.dispatch).toHaveBeenCalled();
  });

  it('assina/desassina transaction do editor no mount/unmount', () => {
    const editor = fakeEditor('alpha X alpha X alpha');
    const { unmount } = render(<FindReplacePopover editor={editor} onClose={vi.fn()} />);
    expect(editor.on).toHaveBeenCalledWith('transaction', expect.any(Function));
    unmount();
    expect(editor.off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });

  it('↓ avança a ocorrência ativa a cada clique (re-render por transação)', () => {
    const editor = fakeEditor('alpha X alpha X alpha'); // matches em 0,8,16
    editor.state.selection = { from: 0, to: 5 }; // ativa = 1ª ocorrência
    render(<FindReplacePopover editor={editor} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: 'alpha' } });
    const next = screen.getByText('↓');
    fireEvent.click(next);
    expect(editor.__setTextSelection).toHaveBeenLastCalledWith({ from: 8, to: 13 });
    fireEvent.click(next);
    expect(editor.__setTextSelection).toHaveBeenLastCalledWith({ from: 16, to: 21 });
    fireEvent.click(next);
    expect(editor.__setTextSelection).toHaveBeenLastCalledWith({ from: 0, to: 5 });
  });
});
