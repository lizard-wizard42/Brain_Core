import { useState, useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/core';

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: string;
  action: (editor: Editor) => void;
}

interface SlashMenuProps {
  editor: Editor;
  commands: SlashCommand[];
  query: string;
  position: { top: number; left: number };
  onClose: () => void;
}

export function SlashMenu({ editor, commands, query, position, onClose }: SlashMenuProps) {
  const [selectionState, setSelectionState] = useState({ query: '', index: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const filtered = commands.filter(
    cmd =>
      cmd.label.toLowerCase().includes(query.toLowerCase()) ||
      cmd.description.toLowerCase().includes(query.toLowerCase())
  );

  const selected = selectionState.query === query
    ? Math.min(selectionState.index, Math.max(0, filtered.length - 1))
    : 0;

  const updateSelected = useCallback((nextIndex: number) => {
    setSelectionState({ query, index: nextIndex });
  }, [query]);

  const execute = useCallback((cmd: SlashCommand) => {
    // Remove the slash + query text that was typed
    const { state } = editor;
    const { from } = state.selection;
    editor.chain()
      .deleteRange({ from: from - query.length - 1, to: from })
      .run();
    cmd.action(editor);
    onClose();
  }, [editor, query, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!filtered.length) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        updateSelected((selected + 1) % (filtered.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        updateSelected((selected - 1 + (filtered.length || 1)) % (filtered.length || 1));
      } else if (e.key === 'Enter') {
        const command = filtered[selected];
        if (!command) return;
        e.preventDefault();
        execute(command);
      } else if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [filtered, selected, execute, onClose, updateSelected]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  if (!filtered.length) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[100] bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl py-1 w-64"
      style={{ top: position.top, left: position.left }}
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.id}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
            i === selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
          }`}
          onMouseEnter={() => updateSelected(i)}
          onMouseDown={e => e.preventDefault()}
          onClick={() => execute(cmd)}
        >
          <span className="text-xl w-7 text-center shrink-0">{cmd.icon}</span>
          <div>
            <div className="text-[13px] text-[#d4d4d4] font-medium">{cmd.label}</div>
            <div className="text-[11px] text-gray-600">{cmd.description}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
