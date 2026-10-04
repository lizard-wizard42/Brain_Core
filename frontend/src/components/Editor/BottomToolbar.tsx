import { useEffect, useRef, useState } from 'react';
import type { SaveStatus } from './editorUtils';
import { createPortal } from 'react-dom';
import { type Editor as TiptapEditor } from '@tiptap/react';
import { PageHistoryPanel } from '../Shared/PageHistoryPanel';
import type { PageVersion } from '../../types';
import { NewTableModal } from './EditorModals';
import { type SavedSel, FontColorDropdown, HighlightDropdown, LinkButton, EmojiToolbarButton, ToolbarButton } from './ToolbarControls';

function findTextMatches(editor: TiptapEditor, query: string): Array<{ from: number; to: number }> {
  const needle = query.trim();
  if (!needle) return [];

  const matches: Array<{ from: number; to: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let searchFrom = 0;
    while (searchFrom <= node.text.length - needle.length) {
      const foundAt = node.text.indexOf(needle, searchFrom);
      if (foundAt === -1) break;
      matches.push({ from: pos + foundAt, to: pos + foundAt + needle.length });
      searchFrom = foundAt + Math.max(needle.length, 1);
    }
  });
  return matches;
}

export function FindReplacePopover({
  editor,
  onClose,
}: {
  editor: TiptapEditor;
  onClose: () => void;
}) {
  const [findValue, setFindValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findInputRef.current?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [onClose]);

  const matches = findTextMatches(editor, findValue);
  const currentSelection = editor.state.selection;
  const activeIndex = matches.findIndex(
    (match) => match.from === currentSelection.from && match.to === currentSelection.to
  );

  const jumpToMatch = (direction: 'next' | 'prev') => {
    if (!matches.length) return;
    const currentIndex = activeIndex >= 0 ? activeIndex : (direction === 'next' ? -1 : 0);
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % matches.length
      : (currentIndex - 1 + matches.length) % matches.length;
    const target = matches[nextIndex];
    editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).run();
  };

  const replaceCurrent = () => {
    if (!findValue.trim()) return;
    const selectedText = editor.state.doc.textBetween(currentSelection.from, currentSelection.to, '\n');
    const target = activeIndex >= 0
      ? matches[activeIndex]
      : matches.find((match) => match.from >= currentSelection.from) ?? matches[0];
    if (!target) return;

    if (selectedText !== findValue) {
      editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).run();
    }
    const tr = editor.state.tr.insertText(replaceValue, target.from, target.to);
    editor.view.dispatch(tr);
    const nextPos = target.from + replaceValue.length;
    editor.chain().focus().setTextSelection({ from: nextPos, to: nextPos }).run();
  };

  const replaceAll = () => {
    if (!findValue.trim() || !matches.length) return;
    let tr = editor.state.tr;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index];
      tr = tr.insertText(replaceValue, match.from, match.to);
    }
    editor.view.dispatch(tr);
    editor.chain().focus().run();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[230]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="absolute bottom-14 left-2 right-2 sm:left-auto sm:right-6 w-auto sm:w-[min(92vw,360px)] rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--theme-border)]">
          <p className="text-[11px] uppercase tracking-wider text-[var(--theme-muted)]">Buscar / Substituir</p>
          <button
            className="text-[11px] text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
        <div className="p-3 space-y-2.5">
          <input
            ref={findInputRef}
            value={findValue}
            onChange={(e) => setFindValue(e.target.value)}
            aria-label="Buscar no texto"
            placeholder="Buscar..."
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--theme-primary)]"
          />
          <input
            value={replaceValue}
            onChange={(e) => setReplaceValue(e.target.value)}
            aria-label="Substituir por"
            placeholder="Substituir por..."
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--theme-primary)]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--theme-muted)]">
              {findValue.trim() ? `${matches.length} ocorrência${matches.length === 1 ? '' : 's'}` : 'Digite para buscar'}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                aria-label="Ocorrência anterior" disabled={!matches.length}
                onClick={() => jumpToMatch('prev')}
                className="min-h-11 px-2 py-1 text-[11px] rounded text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
              >
                ↑
              </button>
              <button
                aria-label="Próxima ocorrência" disabled={!matches.length}
                onClick={() => jumpToMatch('next')}
                className="min-h-11 px-2 py-1 text-[11px] rounded text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
              >
                ↓
              </button>
              <button
                onClick={replaceCurrent}
                className="min-h-11 px-2 py-1 text-[11px] rounded text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
              >
                Substituir
              </button>
              <button
                onClick={replaceAll}
                className="min-h-11 px-2 py-1 text-[11px] rounded bg-[var(--theme-text)] text-[var(--theme-background)] font-medium hover:opacity-90"
              >
                Tudo
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function BottomToolbar({
  editor,
  saveStatus,
  onCreateSubPage,
  creatingSubPage,
  onOpenImagePicker,
  onOpenAttachmentPicker,
  savedSel,
  versions,
  nameById,
  versionsLoading,
  versionsError,
  spellcheckEnabled,
  onToggleSpellcheck,
  onRetrySave,
  onOpenTemplates,
}: {
  editor: TiptapEditor | null;
  saveStatus: SaveStatus;
  onCreateSubPage: () => void;
  creatingSubPage: boolean;
  onOpenImagePicker: () => void;
  onOpenAttachmentPicker: () => void;
  savedSel: React.RefObject<SavedSel>;
  versions: PageVersion[];
  nameById: Map<string, string>;
  versionsLoading: boolean;
  versionsError: string | null;
  spellcheckEnabled: boolean;
  onToggleSpellcheck: () => void;
  onRetrySave: () => void;
  onOpenTemplates?: () => void;
}) {
  const [showTableModal, setShowTableModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const statusText: Record<SaveStatus, string> = {
    idle: '',
    saving: 'Salvando…',
    saved: '✓ Salvo',
    error: '⚠ Erro',
    conflict: '⚠ Conflito',
  };
  const statusColor: Record<SaveStatus, string> = {
    idle: 'text-transparent',
    saving: 'text-[var(--theme-muted)]',
    saved: 'text-green-600',
    error: 'text-red-500',
    conflict: 'text-amber-500',
  };

  if (!editor) return null;

  return (
    <div className="editor-controls flex min-w-0 items-center sticky bottom-0 z-10 shrink-0 bg-[var(--theme-background)] border-t border-[var(--theme-border)] safe-area-bottom">
      <div role="toolbar" aria-label="Ferramentas da página" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1 sm:px-6">
      {showHistory && (
        <PageHistoryPanel
          versions={versions}
          nameById={nameById}
          loading={versionsLoading}
          error={versionsError}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showFindReplace && (
        <FindReplacePopover
          editor={editor}
          onClose={() => setShowFindReplace(false)}
        />
      )}
      <ToolbarButton title="Desfazer" disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}>↶</ToolbarButton>
      <ToolbarButton title="Refazer" disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}>↷</ToolbarButton>
      <span className="text-[var(--theme-border)] mx-1">|</span>
      {/* Text format */}
      <ToolbarButton title="Negrito (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton title="Itálico (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton title="Sublinhado (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span style={{ textDecoration: 'underline' }}>U</span>
      </ToolbarButton>
      <ToolbarButton title="Tachado" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <s>S</s>
      </ToolbarButton>
      <ToolbarButton title="Código" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>`</ToolbarButton>

      <span className="text-[var(--theme-border)] mx-1">|</span>

      {/* Headings */}
      <ToolbarButton title="Título 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
      <ToolbarButton title="Título 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
      <ToolbarButton title="Título 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>

      <span className="text-[var(--theme-border)] mx-1">|</span>

      {/* Lists */}
      <ToolbarButton title="Lista" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>≡</ToolbarButton>
      <ToolbarButton title="Lista numerada" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
      <ToolbarButton title="Lista de tarefas" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>☑</ToolbarButton>

      <span className="text-[var(--theme-border)] mx-1">|</span>

      {/* Blocks */}
      <ToolbarButton title="Citação" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>"</ToolbarButton>
      <ToolbarButton title="Bloco de código" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{'</>'}</ToolbarButton>
      {showTableModal && (
        <NewTableModal
          onConfirm={(rows, cols) => {
            setShowTableModal(false);
            editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
          }}
          onClose={() => setShowTableModal(false)}
        />
      )}
      <ToolbarButton title="Tabela" active={editor.isActive('table')} onClick={() => setShowTableModal(true)}>⊞</ToolbarButton>
      <ToolbarButton title="Linha divisória" onClick={() => editor.chain().focus().setHorizontalRule().run()}>—</ToolbarButton>

      <span className="text-[var(--theme-border)] mx-1">|</span>

      {/* Font color */}
      <FontColorDropdown editor={editor} savedSel={savedSel} />

      {/* Highlight */}
      <HighlightDropdown editor={editor} savedSel={savedSel} />

      {/* Link */}
      <LinkButton editor={editor} savedSel={savedSel} />

      {/* Emoji */}
      <EmojiToolbarButton editor={editor} />

      {/* Imagem */}
      <button
        type="button"
        aria-label="Inserir imagem"
        title="Inserir imagem"
        onMouseDown={e => e.preventDefault()}
        onClick={onOpenImagePicker}
        className="min-h-11 min-w-11 px-2 py-1 text-xs rounded transition-colors text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
      >
        🖼️
      </button>

      {/* Anexo */}
      <button
        type="button"
        aria-label="Anexar arquivo"
        title="Anexar arquivo"
        onMouseDown={e => e.preventDefault()}
        onClick={onOpenAttachmentPicker}
        className="min-h-11 min-w-11 px-2 py-1 text-xs rounded transition-colors text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
      >
        📎
      </button>

      {onOpenTemplates && (
        <ToolbarButton title="Modelos" onClick={onOpenTemplates}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />
          </svg>
        </ToolbarButton>
      )}

      <span className="text-[var(--theme-border)] mx-1">|</span>

      {/* Sub-page */}
      <button
        type="button"
        title="Criar sub-página"
        onMouseDown={e => e.preventDefault()}
        onClick={onCreateSubPage}
        disabled={creatingSubPage}
        aria-label="Criar sub-página"
        className="min-h-11 min-w-11 px-2 py-1 text-xs rounded text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-hover)] transition-colors disabled:opacity-40"
      >
        +
      </button>
      <button
        type="button"
        title="Buscar e substituir"
        onMouseDown={e => e.preventDefault()}
        onClick={() => setShowFindReplace(v => !v)}
        aria-label="Buscar e substituir"
        className="min-h-11 min-w-11 px-2 py-1 text-xs rounded text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-hover)] transition-colors"
      >
        ⌕
      </button>

      </div>
      <div className="flex min-h-11 shrink-0 items-center gap-1 border-l border-[var(--theme-border)] px-2 sm:gap-3 sm:px-4">
        <button
          type="button"
          aria-pressed={spellcheckEnabled}
          aria-label={spellcheckEnabled ? 'Desativar corretor nativo do navegador' : 'Ativar corretor nativo do navegador'}
          title={spellcheckEnabled ? 'Desativar corretor nativo' : 'Ativar corretor nativo'}
          onClick={onToggleSpellcheck}
          className={`spelling-status-badge ${spellcheckEnabled ? 'spelling-status-badge--active spelling-status-badge--ok' : ''}`}
        >
          {spellcheckEnabled ? '✓' : '✕'}
        </button>
        <button
          type="button"
          aria-label="Histórico de versões"
          title="Histórico de versões"
          onClick={() => setShowHistory(v => !v)}
          className="min-h-11 whitespace-nowrap px-2 py-1 text-xs rounded transition-colors text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
        >
          ↺ {versions.length}
        </button>
        <span role="status" aria-live="polite" className={`whitespace-nowrap text-xs transition-colors ${statusColor[saveStatus]}`}>
          {statusText[saveStatus]}
        </span>
        {saveStatus === 'error' && (
          <button type="button" onClick={onRetrySave}
            className="min-h-11 whitespace-nowrap text-xs text-[var(--theme-text)] underline">Tentar salvar</button>
        )}
      </div>
    </div>
  );
}

// ── Main Editor ───────────────────────────────────────────────────────────
