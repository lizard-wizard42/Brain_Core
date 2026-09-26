import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PageVersion } from '../../types';
import { contentToBlocks, formatDateTime, resolveAuthorName, summarizeDiff } from './sharedModel';

const REASON_LABEL: Record<string, string> = {
  content: 'Conteúdo',
  'content+title': 'Conteúdo e título',
  restore: 'Restauração',
  create: 'Criação',
};

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

export function PageHistoryPanel({
  versions,
  nameById,
  loading,
  error,
  onClose,
}: {
  versions: PageVersion[];
  nameById: Map<string, string>;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (previewId) setPreviewId(null);
        else onClose();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, previewId]);

  const entries = useMemo(() => versions.map((version, index) => {
    const older = versions[index + 1];
    const summary = index === versions.length - 1
      ? { label: 'Primeira versão registrada' }
      : summarizeDiff(older?.content, version.content);
    return { version, summary };
  }), [versions]);

  const preview = previewId ? versions.find((version) => version.id === previewId) ?? null : null;
  const previewBlocks = contentToBlocks(preview?.content);
  const isCurrent = preview ? preview.id === versions[0]?.id : false;

  return createPortal(
    <div
      className="fixed inset-0 z-[300]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Histórico de versões da página"
        className="absolute bottom-14 right-2 flex max-h-[70vh] w-[min(94vw,400px)] flex-col overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-2xl sm:right-6"
      >
        <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-[var(--theme-muted)]">Histórico ({versions.length})</p>
          <button type="button" onClick={onClose} className="min-h-8 px-1 text-[11px] text-[var(--theme-muted)] hover:text-[var(--theme-text)]">Fechar</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="py-4 text-center text-[12px] text-[var(--theme-muted)]">Carregando histórico…</p>
          ) : error ? (
            <p role="alert" className="rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-4 text-center text-[12px] text-[var(--theme-muted)]">{error}</p>
          ) : versions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-4 text-center text-[12px] text-[var(--theme-muted)]">Sem versões registradas ainda. O histórico aparece após a primeira alteração salva.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {entries.map(({ version, summary }) => (
                <li key={version.id} className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-[var(--theme-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">{reasonLabel(version.reason)}</span>
                    <span className="text-[11px] text-[var(--theme-muted)]">{formatDateTime(version.created_at)}</span>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-[var(--theme-text)]">{resolveAuthorName(version, nameById) ?? 'Autoria não identificada'}</p>
                  <p className="text-[11px] text-[var(--theme-muted)]">{summary.label}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewId(version.id)}
                      className="min-h-8 rounded-md border border-[var(--theme-border)] px-2 text-[11px] text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
                    >
                      Visualizar versão anterior
                    </button>
                    <span className="text-[10px] text-[var(--theme-muted)]" title="Restauração ainda não liberada pelo backend">Restaurar indisponível</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {preview && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Visualização de versão anterior"
            className="absolute inset-0 flex flex-col bg-[var(--theme-surface)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold">{preview.title}</p>
                <p className="text-[11px] text-[var(--theme-muted)]">
                  {resolveAuthorName(preview, nameById) ?? 'Autoria não identificada'} · {formatDateTime(preview.created_at)}
                  {isCurrent ? ' · versão atual' : ' · somente leitura'}
                </p>
              </div>
              <button type="button" onClick={() => setPreviewId(null)} aria-label="Voltar ao histórico" className="min-h-8 px-1 text-[11px] text-[var(--theme-muted)] hover:text-[var(--theme-text)]">Voltar</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {previewBlocks.length === 0 ? (
                <p className="text-[12px] text-[var(--theme-muted)]">Esta versão não tem texto legível (documento vazio ou desenhado).</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {previewBlocks.map((block, index) => (
                    <p key={index} className="whitespace-pre-wrap text-[13px] leading-5">{block}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
