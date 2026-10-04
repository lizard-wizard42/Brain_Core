import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Page, PageTemplateSummary, TiptapDoc } from '../../types';
import { builtInTemplates } from './noteTemplates';

export function NoteTemplatesDialog({ pageId, title, getCurrentContent, onClose, onRefresh, onNavigate }: {
  pageId: string; title: string; getCurrentContent: () => TiptapDoc; onClose: () => void;
  onRefresh?: () => void; onNavigate?: (page: Page) => void;
}) {
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const [templates, setTemplates] = useState<PageTemplateSummary[]>([]);
  const [listError, setListError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState('study');
  const [newTitle, setNewTitle] = useState('Nova nota');
  const [asChild, setAsChild] = useState(false);
  const [templateName, setTemplateName] = useState(title.slice(0, 80));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const builtin = builtInTemplates.find(t => t.id === selected);

  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLSelectElement>('select')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    api.listPageTemplates().then(rows => { if (active) { setTemplates(rows); setLoading(false); setListError(false); } })
      .catch(() => { if (active) { setListError(true); setLoading(false); } });
    return () => { active = false; };
  }, [attempt]);

  const create = async () => {
    if (busy || !newTitle.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const content = builtin?.content ?? (await api.getPageTemplate(selected)).content;
      const page = await api.createPage({ title: newTitle.trim(), slug: crypto.randomUUID(), type: 'note', content, parent_page_id: asChild ? pageId : null });
      onRefresh?.(); onClose();
      if (onNavigate) onNavigate(page); else navigate(`/page/${page.id}`);
    } catch { setError('Não foi possível criar a página. Confira a conexão e tente novamente.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (busy || !templateName.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await api.savePageTemplate(templateName.trim(), getCurrentContent());
      setTemplates(rows => [...rows, saved]); setSelected(saved.id);
      setMessage('Modelo salvo na sua conta. A página original permanece intacta.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o modelo.'); }
    finally { setBusy(false); }
  };
  const field = 'min-h-11 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-3 text-sm text-[var(--theme-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]';
  const button = 'min-h-11 rounded-lg border border-[var(--theme-border)] px-3 text-sm hover:bg-[var(--theme-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)] disabled:opacity-50';

  return createPortal(<div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="Modelos de notas" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-5 text-[var(--theme-text)] shadow-2xl sm:p-6"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
        if (event.key === 'Tab') {
          const items = [...(panel.current?.querySelectorAll<HTMLElement>(':is(button, input, select, summary):not(:disabled)') ?? [])].filter(item => item.tagName === 'SUMMARY' || !item.closest('details:not([open])'));
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <h2 className="text-xl font-semibold">Modelos de notas</h2>
      <p className="mt-1 text-sm text-[var(--theme-muted)]">Crie uma nova página com uma estrutura pronta.</p>
      <label className="mt-5 block text-sm">Modelo
        <select className={`${field} mt-1`} value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>
          <optgroup label="Prontos para usar">{builtInTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
          {!!templates.length && <optgroup label="Meus modelos">{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
        </select>
      </label>
      {builtin && <div className="mt-3 rounded-lg border border-[var(--theme-border)] p-3 text-sm text-[var(--theme-muted)]">
        <p>{builtin.description}</p><ul className="mt-2 list-disc space-y-1 pl-5">{builtin.content.content.filter(n => n.type === 'heading').map((n, i) => <li key={i}>{n.content?.[0]?.text}</li>)}</ul>
      </div>}
      {loading && <p role="status" className="mt-2 text-xs text-[var(--theme-muted)]">Carregando seus modelos…</p>}
      {listError && <div role="alert" className="mt-2 text-sm">Não foi possível carregar seus modelos. <button className={button} type="button" disabled={busy} onClick={() => { setLoading(true); setListError(false); setAttempt(n => n + 1); }}>Recarregar modelos</button></div>}
      <label className="mt-4 block text-sm">Título da nova página<input className={`${field} mt-1`} maxLength={160} value={newTitle} disabled={busy} onChange={e => setNewTitle(e.target.value)} /></label>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={asChild} disabled={busy} onChange={e => setAsChild(e.target.checked)} />Criar dentro da página atual</label>
      <details className="mt-4 rounded-lg border border-[var(--theme-border)] p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">Salvar esta página como modelo</summary>
        <p className="mb-3 text-xs leading-relaxed text-[var(--theme-muted)]">Salva o texto e a estrutura atuais. Imagens, anexos e cartões de subpáginas ficam de fora; tarefas voltam a ficar desmarcadas. O modelo fica no banco local da sua conta.</p>
        <label className="block text-sm">Nome do modelo<input className={`${field} mt-1`} maxLength={80} value={templateName} disabled={busy} onChange={e => setTemplateName(e.target.value)} /></label>
        <button type="button" className={`${button} mt-3`} disabled={busy || loading || !templateName.trim()} onClick={() => void save()}>Salvar modelo</button>
      </details>
      {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className={button} disabled={busy} onClick={onClose}>Fechar</button>
        <button type="button" className={`${button} bg-[var(--theme-text)] text-[var(--theme-background)] hover:opacity-90`} disabled={busy || !newTitle.trim()} onClick={() => void create()}>{busy ? 'Aguarde…' : 'Criar página'}</button>
      </div>
    </div>
  </div>, document.body);
}
