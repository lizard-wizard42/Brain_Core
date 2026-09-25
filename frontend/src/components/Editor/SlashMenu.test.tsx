import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlashMenu, type SlashCommand } from './SlashMenu';

function makeEditor() {
  const run = vi.fn();
  const deleteRange = vi.fn().mockReturnValue({ run });
  const chain = vi.fn().mockReturnValue({ deleteRange });

  return {
    state: { selection: { from: 10 } },
    chain,
    _spies: { chain, deleteRange, run },
  } as any;
}

describe('SlashMenu', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('executa comando selecionado no Enter', () => {
    const editor = makeEditor();
    const action = vi.fn();
    const onClose = vi.fn();
    const commands: SlashCommand[] = [
      {
        id: 'h1',
        label: 'Título 1',
        description: 'Cabeçalho',
        icon: 'H',
        action,
      },
    ];

    render(
      <SlashMenu
        editor={editor}
        commands={commands}
        query="cab"
        position={{ top: 10, left: 10 }}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(editor._spies.deleteRange).toHaveBeenCalledWith({ from: 6, to: 10 });
    expect(editor._spies.run).toHaveBeenCalled();
    expect(action).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('fecha no Escape e permite clique no comando', () => {
    const editor = makeEditor();
    const action = vi.fn();
    const onClose = vi.fn();
    const commands: SlashCommand[] = [
      {
        id: 'todo',
        label: 'Checklist',
        description: 'Lista de tarefas',
        icon: '☑',
        action,
      },
    ];

    render(
      <SlashMenu
        editor={editor}
        commands={commands}
        query="check"
        position={{ top: 20, left: 20 }}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole('button', { name: /Checklist/i }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('nao renderiza quando filtro nao encontra comando', () => {
    const editor = makeEditor();
    const action = vi.fn();
    const onClose = vi.fn();
    const commands: SlashCommand[] = [
      {
        id: 'table',
        label: 'Tabela',
        description: 'Inserir tabela',
        icon: '▦',
        action,
      },
    ];

    const { container } = render(
      <SlashMenu
        editor={editor}
        commands={commands}
        query="zzzzz"
        position={{ top: 20, left: 20 }}
        onClose={onClose}
      />,
    );

    expect(container).toBeEmptyDOMElement();

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    expect(document.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
