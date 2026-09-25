import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { TiptapDoc } from '../../types';
import { api } from '../../api/client';
import { organizeDocStructure, docsEqual } from './organizeDoc';
import {
  extractCustomNodes,
  reinsertCustomNodes,
  docToMarkdown,
  markdownToDoc,
  findUnreinsertedTokens,
} from './editorMarkdown';

/**
 * Converte um erro da chamada de IA numa mensagem limpa para `alert()`.
 * As falhas de API chegam como `Error('API 502: {"error":"..."}')`; extraímos o
 * campo `.error` do corpo JSON quando possível, senão caímos num texto genérico.
 */
function cleanAiError(e: unknown): string {
  const raw = e instanceof Error ? e.message : '';
  const m = raw.match(/^API\s+\d+:\s*(.*)$/s);
  if (m) {
    try {
      const body = JSON.parse(m[1]);
      if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
    } catch {
      /* corpo não-JSON — usa fallback */
    }
    return 'Não foi possível reorganizar a página.';
  }
  return raw || 'Não foi possível reorganizar a página.';
}

export function AiMenu({
  editor,
  pageId,
  checkAiEnabled = () => api.aiStatus().then(r => r.enabled),
  organizeViaApi = api.aiOrganizePage,
  snapshotVersion = api.snapshotPageVersion,
}: {
  editor: TiptapEditor | null;
  pageId: string;
  checkAiEnabled?: () => Promise<boolean>;
  organizeViaApi?: (id: string, markdown: string) => Promise<{ markdown: string }>;
  snapshotVersion?: (id: string, reason: 'ia' | 'manual') => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiOk, setAiOk] = useState<boolean | null>(null);
  // O toolbar tem `overflow-x-auto`, então um dropdown `absolute` seria recortado.
  // Igual aos outros menus da barra, renderizamos via portal ancorado ao botão.
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    const tid = setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
    return () => { clearTimeout(tid); document.removeEventListener('pointerdown', onOutside); };
  }, [open]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    if (open && aiOk === null) {
      checkAiEnabled().then(setAiOk).catch(() => setAiOk(false));
    }
  }, [open, aiOk, checkAiEnabled]);

  if (!editor) return null;

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top - 6, left: r.left });
    setOpen(true);
  };

  const flash = (m: string) => { setMsg(m); setOpen(false); };

  const handleQuick = () => {
    const current = editor.getJSON() as TiptapDoc;
    const next = organizeDocStructure(current);
    if (docsEqual(current, next)) { flash('Nada a arrumar'); return; }
    editor.chain().setContent(next).run();
    flash('Página arrumada — desfazer em ↺');
  };

  const handleAi = async () => {
    if (!editor || !aiOk) return;
    setBusy(true);
    try {
      const original = editor.getJSON() as TiptapDoc;
      const { doc: stripped, placeholders } = extractCustomNodes(original);
      const md = docToMarkdown(stripped);
      const { markdown: organized } = await organizeViaApi(pageId, md);
      const aiDoc = markdownToDoc(organized);
      const missing = findUnreinsertedTokens(aiDoc, placeholders);
      if (missing.length) {
        setOpen(false);
        alert('A IA alterou blocos que não podem ser reorganizados (tabela/anexo); reorganização cancelada.');
        return;
      }
      const nextDoc = reinsertCustomNodes(aiDoc, placeholders);
      await snapshotVersion(pageId, 'ia');
      editor.chain().setContent(nextDoc).run();
      flash('Página reorganizada pela IA — desfazer em ↺');
    } catch (e) {
      setOpen(false);
      alert(cleanAiError(e));
    } finally {
      setBusy(false);
    }
  };

  const overlayLeft = Math.max(4, Math.min(anchor.left, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 212));

  return (
    <>
      <button
        ref={btnRef}
        title="Organizar a página"
        aria-label="IA"
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); toggle(); }}
        className="px-2 py-1 text-xs rounded transition-colors font-medium text-gray-500 hover:text-gray-200 hover:bg-white/5"
      >
        IA
      </button>
      {msg && createPortal(
        <div
          className="fixed z-[9999] whitespace-nowrap rounded bg-[#222] px-2 py-1 text-[11px] text-gray-300 shadow-lg"
          style={{ top: anchor.top, left: overlayLeft, transform: 'translateY(-100%)' }}
        >
          {msg}
        </div>,
        document.body,
      )}
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] w-52 rounded-lg border border-[#2a2a2a] bg-[#171717] p-1 shadow-2xl"
          style={{ top: anchor.top, left: overlayLeft, transform: 'translateY(-100%)' }}
        >
          <button
            onClick={handleQuick}
            className="block w-full rounded px-2 py-1.5 text-left text-[13px] text-gray-200 hover:bg-white/5"
          >
            Arrumar (rápido)
          </button>
          <button
            onClick={handleAi}
            disabled={aiOk === false || busy}
            title={aiOk === false ? 'IA não configurada (defina OPENAI_API_KEY)' : ''}
            className="block w-full rounded px-2 py-1.5 text-left text-[13px] text-gray-200 hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {busy ? 'Reorganizando…' : 'Reorganizar com IA'}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
