import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { CopyableCodeBlock } from './CopyableCodeBlock';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { createLowlight, common } from 'lowlight';
import { useSocket } from '../../hooks/useSocket';
import { api } from '../../api/client';
import { ShareBadge } from '../Shared/ShareBadge';
import { ShareManagerModal } from '../Shared/ShareManagerModal';
import { useSharedPages } from '../Shared/sharedPagesContext';
import { describeLastEdit, grantsToNameMap } from '../Shared/sharedModel';
import type { PageGrant } from '../../types';
import { SubPageBlock } from './SubPageBlock';
import { SubPageBlockView } from './SubPageBlockView';
import { SubPagesKanban } from './SubPagesKanban';
import { AttachmentBlock } from './AttachmentBlock';
import { AttachmentBlockView } from './AttachmentBlockView';
import { SlashMenu, type SlashCommand } from './SlashMenu';
import { findTrailingEditorTriggerQuery } from './triggers';
import type { Page, PageSummary, PageVersion, TiptapDoc, TiptapNode } from '../../types';
import { toSlug, whenEditorViewReady } from './editorUtils';
import { getCachedAllPages, loadAllPagesCached } from './allPagesCache';
import { ResizableImage } from './ResizableImage';
import { NewSubPageModal, TypeSelectorModal } from './EditorModals';
import { CoverImage } from './EditorCover';
import { AtPicker } from './AtPicker';
import { PageHeader } from './PageHeader';
import { NoteTemplatesDialog } from './NoteTemplatesDialog';
import { PageNavigation } from './PageNavigation';
import { type SavedSel, TableControls } from './ToolbarControls';
import { BottomToolbar } from './BottomToolbar';
import { useTextEditorPersistence } from './useTextEditorPersistence';
import { PageWritingGaps } from './PageWritingGaps';
import { PageDragBridge } from './PageDragBridge';
import { PageMoveError, movePageInto } from './pageNesting';

const lowlight = createLowlight(common);

interface EditorProps {
  page: Page;
  onRefresh?: () => void;
  headerSlot?: ReactNode;
  onNavigatePage?: (page: { id: string; title: string; icon?: string | null }, openInNewTab?: boolean) => void;
}

export function Editor({ page, onRefresh, headerSlot, onNavigatePage }: EditorProps) {
  const [title, setTitle] = useState(page.title);
  // Mantém titleRef sempre atualizado para uso em closures do editor
  useEffect(() => { titleRef.current = title; }, [title]);
  const [icon, setIcon] = useState<string>(page.icon ?? '');
  const [coverUrl, setCoverUrl] = useState<string | null>(page.cover_url ?? null);
  const [coverPositionY, setCoverPositionY] = useState<number>(page.cover_position_y ?? 50);
  const [viewMode, setViewMode] = useState<'document' | 'kanban'>('document');
  const subPageOrderKeyRef = useRef<string>('');
  const syncSubPageOrderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Refs estáveis para não recriar o editor a cada render
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  const onNavigatePageRef = useRef(onNavigatePage);
  useEffect(() => { onNavigatePageRef.current = onNavigatePage; }, [onNavigatePage]);
  const titleRef = useRef(page.title);
  // Salva a última seleção conhecida — atualizada tanto em onBlur quanto em selectionUpdate
  const savedSelRef = useRef<SavedSel>(null);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [grants, setGrants] = useState<PageGrant[]>([]);
  const [isShareOwner, setIsShareOwner] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showShareManager, setShowShareManager] = useState(false);
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(true);
  const shared = useSharedPages();
  const sharedEntry = shared.getEntry(page.id);

  // All pages (for @ picker)
  const [allPages, setAllPages] = useState<PageSummary[]>(() => getCachedAllPages() ?? []);
  useEffect(() => {
    let cancelled = false;
    loadAllPagesCached()
      .then((pages) => {
        if (!cancelled) setAllPages(pages);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadVersionHistory = useCallback(() => {
    setVersionsLoading(true);
    api.getPageVersions(page.id, 30).then((history) => {
      setVersions(history.versions);
      setVersionsError(null);
    }).catch((err) => {
      setVersions([]);
      setVersionsError(/API 40[34]/.test(String(err))
        ? 'Histórico disponível apenas para o dono e para quem pode editar.'
        : 'Não foi possível carregar o histórico.');
    }).finally(() => setVersionsLoading(false));
  }, [page.id]);

  useEffect(() => {
    loadVersionHistory();
  }, [loadVersionHistory]);

  useEffect(() => {
    let active = true;
    (async () => {
      const map = new Map<string, string>();
      setGrants([]);
      setIsShareOwner(false);
      try {
        const me = await api.getMe();
        if (me.name) map.set(me.id, me.name);
      } catch { /* nome do usuário atual é opcional */ }
      try {
        const grants = await api.getPageGrants(page.id);
        grantsToNameMap(grants).forEach((value, key) => map.set(key, value));
        if (active) setGrants(grants);
        // A rota de grants é restrita ao dono: sucesso aqui significa dono da página.
        if (active) setIsShareOwner(true);
      } catch { /* sem permissão para ver acessos */ }
      if (active) setNameById(map);
    })();
    return () => { active = false; };
  }, [page.id]);

  // @ picker state
  const [atPicker, setAtPicker] = useState<{
    query: string;
    position: { top: number; left: number };
    from: number;
  } | null>(null);
  const [slashMenu, setSlashMenu] = useState<{
    query: string;
    position: { top: number; left: number };
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const persistence = useTextEditorPersistence(page, loadVersionHistory);
  const { status: saveStatus, conflict: conflictState, ready, recoverable, draftWarning,
    saveNow: persistContentNow, change, discard, recover, currentDraft, acceptMetadata } = persistence;
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [pageMoving, setPageMoving] = useState(false);
  const [moveNeedsReload, setMoveNeedsReload] = useState(false);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const movePending = useRef(false);
  const canEdit = ready && !recoverable && !pageMoving && !moveNeedsReload;
  const { joinPage, leavePage } = useSocket();
  const triggerSave = useCallback((ed: TiptapEditor, currentTitle: string) => {
    change(ed.getJSON() as TiptapDoc, currentTitle);
  }, [change]);

  const handleNestPage = useCallback(async (ed: TiptapEditor, draggedId: string, targetId: string) => {
    if (movePending.current || !ed.isEditable) return;
    movePending.current = true; setPageMoving(true); setMoveNotice(null);
    ed.setEditable(false);
    clearTimeout(syncSubPageOrderTimerRef.current);
    try {
      const fresh = await movePageInto(page.id, draggedId, targetId, async () => {
        await persistContentNow(ed.getJSON() as TiptapDoc, titleRef.current);
        return persistence.isFullySaved();
      });
      await discard(fresh);
      titleRef.current = fresh.title; setTitle(fresh.title);
      ed.commands.setContent(fresh.content, { emitUpdate: false });
      onRefreshRef.current?.();
      setMoveNotice('Página movida. A árvore e o documento foram atualizados.');
    } catch (error) {
      if (error instanceof PageMoveError && error.committed) {
        setMoveNeedsReload(true); setMoveNotice(error.message);
      }
      throw error;
    } finally { movePending.current = false; setPageMoving(false); }
  }, [discard, page.id, persistContentNow, persistence]);

  const syncSubPageOrder = useCallback(async (ed: TiptapEditor) => {
    const subPageIds: string[] = [];
    ed.state.doc.descendants(node => {
      if (node.type.name === 'subPageBlock' && node.attrs.source !== 'reference' && node.attrs.pageId) {
        subPageIds.push(node.attrs.pageId);
      }
    });

    if (subPageIds.length === 0) return;

    try {
      const subPages = await api.getSubPages(page.id);
      const validChildIds = new Set(subPages.map(sp => sp.id));
      const orderedChildIds = subPageIds.filter(id => validChildIds.has(id));
      if (orderedChildIds.length === 0) return;

      // Update sort_order for each sub-page based on its position in the editor
      await Promise.all(orderedChildIds.map((id, index) =>
        api.patchPage(id, { sort_order: index * 1000 })
      ));
      onRefresh?.();
    } catch (err) {
      console.error('Failed to sync sub-page order:', err);
    }
  }, [onRefresh, page.id]);

  const getSubPageOrderFromDoc = useCallback((doc: { descendants: (fn: (node: { type: { name: string }; attrs: { pageId?: string; source?: string } }) => void) => void }) => {
    const ids: string[] = [];
    doc.descendants((node) => {
      if (node.type.name === 'subPageBlock' && node.attrs.source !== 'reference' && node.attrs.pageId) {
        ids.push(node.attrs.pageId);
      }
    });
    return ids;
  }, []);

  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit.configure({ codeBlock: false, underline: false, link: false, dropcursor: { color: 'var(--theme-primary)', width: 2 } }),
      PageWritingGaps,
      PageDragBridge,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      CopyableCodeBlock.configure({ lowlight }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Underline,
      Link.configure({ openOnClick: false }),
      ResizableImage.configure({ inline: false, allowBase64: false }),
      SubPageBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(
            (props) => SubPageBlockView({ ...props, onRefresh: () => onRefreshRef.current?.(), onNavigatePage: (page, openInNewTab) => onNavigatePageRef.current?.(page, openInNewTab), onNestPage: (draggedId, targetId) => handleNestPage(props.editor, draggedId, targetId) })
          );
        },
      }),
      AttachmentBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(AttachmentBlockView);
        },
      }),
      Placeholder.configure({ placeholder: 'Escreva algo, ou pressione "/" para comandos…' }),
    ],
    // Normalize empty doc so the editor always has at least one paragraph to click into
    content: ('type' in page.content && (page.content.content?.length ?? 0) > 0)
      ? page.content
      : { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        spellcheck: 'true',
        autocorrect: 'on',
        autocomplete: 'on',
        autocapitalize: 'off',
        lang: 'pt-BR',
      },
      handlePaste(view, event) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const text = clipboardData.getData('text/plain');
        const html = clipboardData.getData('text/html');
        if (text.trim() || html.trim()) {
          return false;
        }

        const items = clipboardData.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            event.preventDefault();
            api.uploadImage(file).then(url => {
              view.dispatch(view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.image.create({ src: url })
              ));
            }).catch(() => alert('Erro ao fazer upload da imagem'));
            return true;
          }
        }
        return false;
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (!imageFiles.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        imageFiles.forEach(file => {
          api.uploadImage(file).then(url => {
            const node = view.state.schema.nodes.image.create({ src: url });
            const transaction = view.state.tr.insert(pos?.pos ?? view.state.selection.from, node);
            view.dispatch(transaction);
          }).catch(() => alert('Erro ao fazer upload da imagem'));
        });
        return true;
      },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      // Always track the latest selection so dropdowns can restore it
      const { from, to } = ed.state.selection;
      savedSelRef.current = { from, to };
    },
    onBlur: ({ editor: ed }) => {
      // Capture selection the moment editor loses focus (mobile-safe)
      const { from, to } = ed.state.selection;
      savedSelRef.current = { from, to };
    },
    onUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.docChanged) return;

      // Draft the complete document immediately; the server save is debounced.
      triggerSave(ed, titleRef.current);

      // Detect @ for page linking
      const { state } = ed;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n');
      const atQuery = findTrailingEditorTriggerQuery(textBefore, '@');
      const slashQuery = findTrailingEditorTriggerQuery(textBefore, '/');
      if (atQuery !== null) {
        const domPos = ed.view.coordsAtPos(from);
        setAtPicker({
          query: atQuery,
          position: { top: domPos.bottom + 4, left: domPos.left },
          from: from - atQuery.length - 1,
        });
      } else {
        setAtPicker(null);
      }
      if (slashQuery !== null) {
        const domPos = ed.view.coordsAtPos(from);
        setSlashMenu({
          query: slashQuery,
          position: { top: domPos.bottom + 4, left: domPos.left },
        });
      } else {
        setSlashMenu(null);
      }

      // Sync sidebar order only when the subPageBlock sequence actually changes.
      const nextOrder = getSubPageOrderFromDoc(transaction.doc as unknown as { descendants: (fn: (node: { type: { name: string }; attrs: { pageId?: string; source?: string } }) => void) => void });
      const nextOrderKey = nextOrder.join('|');

      if (nextOrderKey !== subPageOrderKeyRef.current) {
        subPageOrderKeyRef.current = nextOrderKey;
        clearTimeout(syncSubPageOrderTimerRef.current);
        syncSubPageOrderTimerRef.current = setTimeout(() => {
          void syncSubPageOrder(ed);
        }, 600);
      }
    },
  });

  useEffect(() => { editor?.setEditable(canEdit); }, [canEdit, editor]);

  useEffect(() => {
    if (!editor) return;
    return whenEditorViewReady(editor, () => {
      const dom = editor.view.dom as HTMLElement;
      dom.setAttribute('spellcheck', spellcheckEnabled ? 'true' : 'false');
      // Keep the boolean property in sync for browsers that prioritize it.
      dom.spellcheck = spellcheckEnabled;
    });
  }, [editor, spellcheckEnabled]);

  useEffect(() => {
    return () => {
      clearTimeout(syncSubPageOrderTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const currentOrder = getSubPageOrderFromDoc(editor.state.doc as unknown as { descendants: (fn: (node: { type: { name: string }; attrs: { pageId?: string; source?: string } }) => void) => void });
    subPageOrderKeyRef.current = currentOrder.join('|');
  }, [editor, page.id, getSubPageOrderFromDoc]);

  const toggleSpellcheck = useCallback(() => {
    setSpellcheckEnabled((current) => !current);
  }, []);

  // Listen for icon changes from any page and update matching subPageBlock nodes
  const editorRef = useRef<TiptapEditor | null>(null);
  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => {
    function handleIconChange(e: Event) {
      const { pageId, icon: newIcon } = (e as CustomEvent<{ pageId: string; icon: string }>).detail;
      const ed = editorRef.current;
      if (!ed) return;
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'subPageBlock' && node.attrs.source !== 'reference' && node.attrs.pageId === pageId) {
          ed.view.dispatch(
            ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, icon: newIcon })
          );
        }
      });
    }
    document.addEventListener('page-icon-changed', handleIconChange);
    return () => document.removeEventListener('page-icon-changed', handleIconChange);
  }, []);

  // Sync sub-pages from sidebar/tree into the editor body (Notion-like)
  useEffect(() => {
    if (!editor || !canEdit) return;
    let active = true;
    api.getSubPages(page.id).then(subPages => {
      if (!active || editor.isDestroyed) return;
      const orderedChildIds = subPages.map(sp => sp.id);
      const childRank = new Map(orderedChildIds.map((id, index) => [id, index]));
      const childById = new Map(subPages.map(sp => [sp.id, sp]));

      const docJson = editor.getJSON();
      const currentContent = (Array.isArray(docJson.content) ? docJson.content : []) as TiptapNode[];
      // Only managed child cards follow the tree. Explicit @ references stay where placed.
      let nextContent = currentContent.filter(node =>
        !(node.type === 'subPageBlock' && node.attrs?.source === 'child' &&
          !childRank.has(String(node.attrs?.pageId ?? '')))
      );

      const managedEntries: Array<{ index: number; id: string; node: TiptapNode }> = [];
      nextContent.forEach((node, index) => {
        if (node.type !== 'subPageBlock') return;
        if (node.attrs?.source === 'reference') return;
        const pageId = typeof node.attrs?.pageId === 'string' ? node.attrs.pageId : null;
        if (!pageId || !childRank.has(pageId)) return;
        managedEntries.push({ index, id: pageId, node });
      });

      const presentChildIds = new Set(managedEntries.map(entry => entry.id));
      const missingNodes = orderedChildIds
        .filter(id => !presentChildIds.has(id))
        .map(id => {
          const sp = childById.get(id);
          return {
            type: 'subPageBlock',
            attrs: { pageId: id, title: sp?.title ?? 'Sem título', icon: sp?.icon ?? '', source: 'child' },
          } as TiptapNode;
        });

      if (managedEntries.length > 0) {
        // Keep the same visual zone in the body, but reorder managed child blocks by sidebar order
        const sortedManaged = [...managedEntries].sort(
          (a, b) => (childRank.get(a.id) ?? 0) - (childRank.get(b.id) ?? 0)
        );
        const sortedIndices = [...managedEntries].map(entry => entry.index).sort((a, b) => a - b);

        sortedIndices.forEach((targetIndex, idx) => {
          const source = sortedManaged[idx];
          const sp = childById.get(source.id);
          nextContent[targetIndex] = {
            ...source.node,
            type: 'subPageBlock',
            attrs: {
              ...(source.node.attrs ?? {}),
              pageId: source.id,
              title: sp?.title ?? source.node.attrs?.title ?? 'Sem título',
              icon: sp?.icon ?? source.node.attrs?.icon ?? '',
              source: 'child',
            },
          };
        });

        if (missingNodes.length) {
          const insertAt = Math.max(...sortedIndices) + 1;
          nextContent.splice(insertAt, 0, ...missingNodes);
        }
      } else if (missingNodes.length) {
        // Preserve intentional empty writing lines when new children appear.
        nextContent = [...nextContent, ...missingNodes];
      }

      if (JSON.stringify(nextContent) === JSON.stringify(currentContent)) return;
      editor.chain().setContent({ type: 'doc', content: nextContent }).run();
    }).catch(() => {});
    return () => { active = false; };
  }, [editor, page.id, canEdit]);

  // Socket room
  useEffect(() => {
    joinPage(page.id);
    return () => { leavePage(page.id); };
  }, [page.id, joinPage, leavePage]);

  // Title change handler — triggers save
  const handleTitleChange = (newTitle: string) => {
    titleRef.current = newTitle;
    setTitle(newTitle);
    if (editor) triggerSave(editor, newTitle);
  };

  const reloadFromServer = useCallback(async () => {
    try {
      const fresh = await api.getPage(page.id);
      await discard(fresh);
      titleRef.current = fresh.title;
      setTitle(fresh.title);
      if (fresh.icon !== undefined) setIcon(fresh.icon ?? '');
      if (fresh.content) editor?.commands.setContent(fresh.content, { emitUpdate: false });
      setRecoveryError(null);
      setMoveNeedsReload(false); setMoveNotice(null);
      loadVersionHistory();
      onRefresh?.();
    } catch {
      setRecoveryError('Não foi possível carregar a versão salva. Seu rascunho foi mantido.');
    }
  }, [discard, editor, loadVersionHistory, onRefresh, page.id]);

  // @ picker: insert link to selected page
  const handleAtSelect = useCallback((p: PageSummary) => {
    if (!editor || !atPicker) return;
    const { from: atFrom } = atPicker;
    const { from: curFrom } = editor.state.selection;
    editor.chain()
      .deleteRange({ from: atFrom, to: curFrom })
      .insertContent({
        type: 'subPageBlock',
        attrs: { pageId: p.id, title: p.title, icon: p.icon ?? '', source: 'reference' },
      })
      .run();
    setAtPicker(null);
  }, [editor, atPicker]);

  // Sub-page modal state
  const [showSubPageModal, setShowSubPageModal] = useState(false);
  const [showSubPageTypeSelector, setShowSubPageTypeSelector] = useState(false);
  const [pendingSubPageTitle, setPendingSubPageTitle] = useState<string | null>(null);
  const [creatingSubPage, setCreatingSubPage] = useState(false);

  const handleUploadImage = useCallback((file: File) => {
    api.uploadImage(file).then(url => {
      if (!editor) return;
      editor.chain().focus().setImage({ src: url }).run();
      const content = editor.getJSON() as TiptapDoc;
      void persistContentNow(content, titleRef.current, { reloadVersions: true }).catch(() => {
        alert('Imagem enviada, mas houve erro ao salvar a página');
      });
    }).catch(() => alert('Erro ao fazer upload da imagem'));
  }, [editor, persistContentNow]);

  const handleUploadAttachment = useCallback((file: File) => {
    api.uploadFile(file).then((uploaded) => {
      if (!editor) return;
      editor.chain().focus().insertAttachmentBlock({
        url: uploaded.url,
        name: uploaded.name,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
      }).run();
      const content = editor.getJSON() as TiptapDoc;
      void persistContentNow(content, titleRef.current, { reloadVersions: true }).catch(() => {
        alert('Arquivo enviado, mas houve erro ao salvar a página');
      });
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao fazer upload do anexo';
      alert(message);
    });
  }, [editor, persistContentNow]);

  const slashCommands = useMemo<SlashCommand[]>(() => {
    if (!editor) return [];

    return [
      { id: 'paragraph', label: 'Texto', description: 'Voltar para parágrafo normal', icon: '¶', action: (ed) => { ed.chain().focus().setParagraph().run(); } },
      { id: 'heading-1', label: 'Título 1', description: 'Cabeçalho principal', icon: 'H1', action: (ed) => { ed.chain().focus().toggleHeading({ level: 1 }).run(); } },
      { id: 'heading-2', label: 'Título 2', description: 'Cabeçalho secundário', icon: 'H2', action: (ed) => { ed.chain().focus().toggleHeading({ level: 2 }).run(); } },
      { id: 'heading-3', label: 'Título 3', description: 'Cabeçalho terciário', icon: 'H3', action: (ed) => { ed.chain().focus().toggleHeading({ level: 3 }).run(); } },
      { id: 'bullet-list', label: 'Lista', description: 'Criar lista com marcadores', icon: '•', action: (ed) => { ed.chain().focus().toggleBulletList().run(); } },
      { id: 'ordered-list', label: 'Lista numerada', description: 'Criar lista ordenada', icon: '1.', action: (ed) => { ed.chain().focus().toggleOrderedList().run(); } },
      { id: 'task-list', label: 'Checklist', description: 'Criar lista de tarefas', icon: '☑', action: (ed) => { ed.chain().focus().toggleTaskList().run(); } },
      { id: 'blockquote', label: 'Citação', description: 'Inserir bloco de citação', icon: '❝', action: (ed) => { ed.chain().focus().toggleBlockquote().run(); } },
      { id: 'code-block', label: 'Bloco de código', description: 'Inserir bloco de código', icon: '</>', action: (ed) => { ed.chain().focus().toggleCodeBlock().run(); } },
      { id: 'divider', label: 'Divisor', description: 'Inserir linha horizontal', icon: '—', action: (ed) => { ed.chain().focus().setHorizontalRule().run(); } },
      { id: 'table', label: 'Tabela', description: 'Inserir tabela 3x3', icon: '⊞', action: (ed) => { ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
      { id: 'image', label: 'Imagem', description: 'Enviar uma imagem', icon: '🖼️', action: () => { imageInputRef.current?.click(); } },
      { id: 'attachment', label: 'Anexo', description: 'Enviar PDF, Office ou texto', icon: '📎', action: () => { attachmentInputRef.current?.click(); } },
      { id: 'sub-page', label: 'Sub-página', description: 'Criar sub-página dentro da nota', icon: '➕', action: () => { setShowSubPageModal(true); } },
    ];
  }, [editor]);

  const handleCreateSubPage = async (subTitle: string, type: 'note' | 'infinite' | 'notebook') => {
    setShowSubPageModal(false);
    setShowSubPageTypeSelector(false);
    setPendingSubPageTitle(null);
    setCreatingSubPage(true);
    try {
      const sub = await api.createPage({
        parent_page_id: page.id,
        title: subTitle,
        slug: toSlug(subTitle),
        type,
      });
      editor?.chain().focus().insertSubPageBlock({
        pageId: sub.id,
        title: sub.title,
        icon: sub.icon ?? '',
      }).run();
      onRefresh?.();
      loadVersionHistory();
    } catch {
      alert('Erro ao criar sub-página');
    } finally {
      setCreatingSubPage(false);
    }
  };

  const downloadDraft = () => {
    const draft = currentDraft();
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'brain-core-draft.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const restoreDraft = () => {
    const draft = recover();
    if (!draft || !editor) return;
    titleRef.current = draft.title; setTitle(draft.title);
    editor.commands.setContent(draft.content, { emitUpdate: false });
  };

  const lastEditLabel = describeLastEdit(versions[0], page.updated_at, nameById);
  const shareRole = sharedEntry?.role ?? (grants.length > 0 ? 'owner' : null);
  const shareCount = grants.length || sharedEntry?.grantees?.length || 0;
  const showShareButton = isShareOwner;
  const showShareBadge = !showShareButton && Boolean(shareRole);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {pageMoving && <div role="status" className="editor-page-move-status">Salvando e movendo a página…</div>}
      {moveNotice && <div role={moveNeedsReload ? 'alert' : 'status'} className="editor-page-move-status"><span>{moveNotice}</span>
        {moveNeedsReload ? <button type="button" onClick={() => { void reloadFromServer(); }}>Recarregar versão salva</button>
          : <button type="button" aria-label="Fechar aviso" onClick={() => setMoveNotice(null)}>×</button>}</div>}
      {!ready && <div role="status" className="border-b border-[var(--theme-border)] px-4 py-2 text-sm">Verificando rascunho local…</div>}
      {recoverable && <div role="status" className="flex flex-wrap items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3 text-sm">
        <span className="flex-1">Há um rascunho local não salvo. Deseja recuperá-lo?
          {recoverable.baseRevision !== page.revision && ' A versão do servidor mudou; a recuperação não substituirá essa versão.'}</span>
        <button type="button" className="min-h-11 rounded-md border border-[var(--theme-border)] px-3" onClick={restoreDraft}>Recuperar rascunho</button>
        <button type="button" className="min-h-11 rounded-md border border-[var(--theme-border)] px-3" onClick={downloadDraft}>Baixar rascunho</button>
        <button type="button" className="min-h-11 rounded-md border border-[var(--theme-border)] px-3" onClick={() => { void reloadFromServer(); }}>Usar versão salva</button>
      </div>}
      {draftWarning && <div role="alert" className="border-b border-[var(--theme-border)] px-4 py-2 text-sm">Não foi possível guardar o rascunho neste navegador. Mantenha a página aberta até aparecer Salvo ou baixe uma cópia.
        <button type="button" className="ml-2 min-h-11 underline" onClick={downloadDraft}>Baixar rascunho</button></div>}
      {recoveryError && <div role="alert" className="px-4 py-2 text-sm">{recoveryError}</div>}
      {showTemplates && editor && <NoteTemplatesDialog pageId={page.id} title={title} getCurrentContent={() => editor.getJSON() as TiptapDoc} onClose={() => setShowTemplates(false)} onRefresh={onRefresh} onNavigate={onNavigatePage} />}
      {showShareManager && (
        <ShareManagerModal
          pageId={page.id}
          pageTitle={title}
          onClose={() => setShowShareManager(false)}
          onChanged={() => {
            shared.refresh();
            api.getPageGrants(page.id).then(setGrants).catch(() => {});
          }}
        />
      )}
      {conflictState && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[12px] text-amber-200">
          <span className="font-medium">Conflito de edição:</span>
          <span className="min-w-0 flex-1">Esta página foi alterada por outra pessoa enquanto você editava. Suas mudanças locais não foram salvas.</span>
          <button type="button" className="min-h-11 underline" onClick={downloadDraft}>Baixar rascunho</button>
          <button
            type="button"
            onClick={() => { void reloadFromServer(); }}
            className="min-h-9 rounded-md border border-amber-500/50 px-2.5 text-amber-100 hover:bg-amber-500/20"
          >
            Recarregar do servidor
          </button>
        </div>
      )}
      {/* @ page picker */}
      {atPicker && (
        <AtPicker
          pages={allPages}
          query={atPicker.query}
          position={atPicker.position}
          onSelect={handleAtSelect}
          onClose={() => setAtPicker(null)}
        />
      )}
      {slashMenu && editor && (
        <SlashMenu
          editor={editor}
          commands={slashCommands}
          query={slashMenu.query}
          position={slashMenu.position}
          onClose={() => setSlashMenu(null)}
        />
      )}
      {/* Sub-page modal */}
      {showSubPageModal && (
        <NewSubPageModal
          onConfirm={(subTitle) => {
            setPendingSubPageTitle(subTitle);
            setShowSubPageModal(false);
            setShowSubPageTypeSelector(true);
          }}
          onClose={() => setShowSubPageModal(false)}
        />
      )}

      {showSubPageTypeSelector && pendingSubPageTitle && (
        <TypeSelectorModal
          onSelect={(type) => { void handleCreateSubPage(pendingSubPageTitle, type); }}
          onClose={() => {
            setShowSubPageTypeSelector(false);
            setPendingSubPageTitle(null);
          }}
        />
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto" inert={!canEdit}>
        {headerSlot && (
          <div className="px-6 pt-6">
            {headerSlot}
          </div>
        )}
        {/* Cover */}
        <CoverImage
          pageId={page.id}
          coverUrl={coverUrl}
          coverPositionY={coverPositionY}
          onMetadataSaved={acceptMetadata}
          onUpdate={(url, posY) => {
            setCoverUrl(url);
            if (posY !== undefined) setCoverPositionY(posY);
          }}
        />

        {/* Page content */}
        <div className="max-w-[720px] mx-auto px-4 sm:px-12 pt-6 sm:pt-8 pb-4">
          <PageNavigation key={page.id} pageId={page.id} title={title} editor={editor} onNavigate={onNavigatePage} />
          <PageHeader
            pageId={page.id}
            icon={icon}
            title={title}
            onIconChange={setIcon}
            onTitleChange={handleTitleChange}
            onMetadataSaved={acceptMetadata}
            onRefresh={onRefresh}
          />
          {(lastEditLabel || showShareButton || showShareBadge) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--theme-muted)]">
              {lastEditLabel && <span>{lastEditLabel}</span>}
              {showShareButton && (
                <button
                  type="button"
                  onClick={() => setShowShareManager(true)}
                  title="Compartilhar com seus contatos"
                  aria-label="Compartilhar esta página"
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-0.5 text-[10px] leading-none text-[var(--theme-text)] hover:border-[var(--theme-accent)]"
                >
                  <span aria-hidden="true">👥</span>
                  <span>{shareCount > 0 ? `Compartilhar · ${shareCount}` : 'Compartilhar'}</span>
                </button>
              )}
              {showShareBadge && (
                <ShareBadge
                  role={shareRole!}
                  count={shareCount}
                  title={`Compartilhada com você: ${shareRole === 'viewer' ? 'pode ler' : 'pode editar'}`}
                />
              )}
            </div>
          )}

          {/* View mode switcher: Document vs Kanban Board */}
          <div className="mt-3 flex items-center justify-between border-b border-[var(--theme-border)] pb-2">
            <div className="flex items-center gap-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-1 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('document')}
                className={`rounded px-2.5 py-1 font-medium transition-colors ${
                  viewMode === 'document'
                    ? 'bg-[var(--theme-primary)] text-white shadow-sm'
                    : 'text-[var(--theme-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                📄 Documento
              </button>
              <button
                type="button"
                onClick={() => setViewMode('kanban')}
                className={`rounded px-2.5 py-1 font-medium transition-colors ${
                  viewMode === 'kanban'
                    ? 'bg-[var(--theme-primary)] text-white shadow-sm'
                    : 'text-[var(--theme-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                📋 Quadro Kanban
              </button>
            </div>
          </div>

          {viewMode === 'document' ? (
            <EditorContent editor={editor} className="mt-2 min-h-[50vh]" />
          ) : (
            <SubPagesKanban
              pageId={page.id}
              onNavigatePage={onNavigatePage}
              onRefreshParent={onRefresh}
            />
          )}
        </div>
      </div>

      {/* Table controls (+col / +row) */}
      <div inert={!canEdit}><TableControls editor={editor} /></div>

      {/* Bottom toolbar */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) {
            handleUploadImage(file);
            setSlashMenu(null);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.rtf,.odt,.ods,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,application/rtf,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) {
            handleUploadAttachment(file);
            setSlashMenu(null);
            e.target.value = '';
          }
        }}
      />
      <div inert={!canEdit}><BottomToolbar
        editor={editor}
        saveStatus={saveStatus}
        onOpenTemplates={() => setShowTemplates(true)}
        onCreateSubPage={() => setShowSubPageModal(true)}
        creatingSubPage={creatingSubPage}
        onOpenImagePicker={() => imageInputRef.current?.click()}
        onOpenAttachmentPicker={() => attachmentInputRef.current?.click()}
        savedSel={savedSelRef}
        versions={versions}
        nameById={nameById}
        versionsLoading={versionsLoading}
        versionsError={versionsError}
        spellcheckEnabled={spellcheckEnabled}
        onToggleSpellcheck={toggleSpellcheck}
        onRetrySave={() => {
          if (!editor) return;
          void persistContentNow(editor.getJSON() as TiptapDoc, titleRef.current,
            { reloadVersions: true }).catch(() => {});
        }}
      /></div>
    </div>
  );
}
