import { useState, useRef, useEffect, type KeyboardEvent } from 'react';

interface QuickDailyCaptureProps {
  onCaptureNote: (text: string) => Promise<void> | void;
  placeholder?: string;
}

export function QuickDailyCapture({
  onCaptureNote,
  placeholder = 'Pensamento rápido / Daily Log... (pressione Enter para salvar)',
}: QuickDailyCaptureProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Shortcut Ctrl+Shift+N or Cmd+Shift+N to focus quick capture
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      await onCaptureNote(trimmed);
      setText('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch {
      // Error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="relative rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 shadow-sm transition-all focus-within:border-[var(--theme-primary)]">
      <div className="flex items-center gap-2">
        <span className="text-lg text-[var(--theme-primary)] pl-1" aria-hidden="true">
          ⚡
        </span>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
          placeholder={placeholder}
          aria-label="Captura rápida diária"
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:outline-none"
        />
        <div className="flex items-center gap-1.5 shrink-0">
          <kbd className="hidden sm:inline-block rounded border border-[var(--theme-border)] bg-[var(--theme-background)] px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)]">
            Ctrl+Shift+N
          </kbd>
          <button
            type="button"
            disabled={!text.trim() || submitting}
            onClick={() => void handleSubmit()}
            aria-label="Salvar registro rápido"
            className="rounded-lg bg-[var(--theme-primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? 'Salvando…' : success ? 'Salvo! ✓' : 'Capturar'}
          </button>
        </div>
      </div>
    </div>
  );
}
