import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RememberDay, RememberSession } from '../../types';
import { rememberService } from '../../services/rememberService';
import { RememberRecorderControl } from './RememberRecorderControl';
import { RememberSearchResults } from './RememberSearchResults';
import { RememberVoiceprintPanel } from './RememberVoiceprintPanel';
import { TranscriptDialogue } from './TranscriptDialogue';
import { copySessionMarkdown, downloadSessionMarkdown } from './rememberExport';
import { onRememberStatus, REMEMBER_PENDING_STATES } from './rememberEvents';
import { emptyDraft, type NoteDraft } from '../Notas/notasModel';

function noteSeedFromSession(session: RememberSession, kind: 'note' | 'reminder'): NoteDraft {
  const when = new Date(session.started_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const body = (session.text ?? '').slice(0, 400);
  return {
    ...emptyDraft(),
    color: kind === 'reminder' ? 'amber' : 'slate',
    title: `Gravação ${when}`,
    body: body ? (session.text && session.text.length > 400 ? `${body}…` : body) : '',
    reminderEnabled: kind === 'reminder',
    reminderDate: kind === 'reminder' ? todayIso() : '',
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'agora';
}

function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes} min`;
}

function sessionDuration(startedAt: string, endedAt: string | null): string {
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return formatSeconds(Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000)));
}

const sessionLabels: Record<string, string> = {
  recording: 'Gravando', syncing: 'Sincronizando…', processing: 'Processando…',
  transcribing: 'Transcrição sendo processada…', ready: 'Pronta', error: 'Erro no processamento',
};

export function RememberMemoryPanel({ onCreateNote }: { onCreateNote?: (draft: NoteDraft) => void } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedDate = searchParams.get('date') || todayIso();
  const rawQuery = searchParams.get('q') ?? '';
  const searching = rawQuery.trim().length >= 2;
  const [queryInput, setQueryInput] = useState(rawQuery);
  const [highlightSessionId, setHighlightSessionId] = useState<string | null>(null);
  const [onlyMe, setOnlyMe] = useState(false);
  const [day, setDay] = useState<RememberDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => { setQueryInput(rawQuery); }, [rawQuery]);

  useEffect(() => {
    if (queryInput === rawQuery) return;
    const handle = window.setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (queryInput.trim()) next.set('q', queryInput);
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [queryInput, rawQuery, setSearchParams]);

  const openDayFromSearch = useCallback((date: string, sessionId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('date', date);
      next.delete('q');
      return next;
    });
    setHighlightSessionId(sessionId);
  }, [setSearchParams]);

  const loadDay = useCallback(async (options?: { silent?: boolean }) => {
    const id = ++requestId.current;
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const next = await rememberService.getDay(selectedDate);
      if (id === requestId.current) setDay(next);
    } catch (reason) {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar este dia');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => { void loadDay(); }, [loadDay]);

  const [copiedSession, setCopiedSession] = useState<string | null>(null);
  const handleCopySession = useCallback(async (session: RememberSession) => {
    const ok = await copySessionMarkdown(session);
    setCopiedSession(session.id);
    window.setTimeout(() => setCopiedSession(null), 2000);
    if (!ok) downloadSessionMarkdown(session);
  }, []);

  const [voiceRefSession, setVoiceRefSession] = useState<string | null>(null);
  const [voiceprintRefreshToken, setVoiceprintRefreshToken] = useState(0);
  const refreshAfterRelabel = useCallback(() => { void loadDay({ silent: true }); }, [loadDay]);
  const handleUseSessionAsVoice = useCallback(async (sessionId: string) => {
    setVoiceRefSession(sessionId);
    try {
      await rememberService.enrollVoiceprintFromSession(sessionId);
      setVoiceprintRefreshToken((value) => value + 1);
      void loadDay({ silent: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível usar esta sessão como referência');
    } finally {
      window.setTimeout(() => setVoiceRefSession(null), 4000);
    }
  }, [loadDay]);

  // Gap 1: reload the timeline whenever capture status changes (start/stop, sync → ready…).
  useEffect(() => onRememberStatus(() => { void loadDay({ silent: true }); }), [loadDay]);

  // Gap 1: keep polling while the day still has sessions the Celtwo is processing.
  const hasPendingSessions = day?.sessions.some((session) => REMEMBER_PENDING_STATES.has(session.status)) ?? false;
  useEffect(() => {
    if (!hasPendingSessions) return;
    const timer = window.setInterval(() => { void loadDay({ silent: true }); }, 8000);
    return () => window.clearInterval(timer);
  }, [hasPendingSessions, loadDay]);

  // After jumping from a search result: scroll the day's session into view and flash it.
  useEffect(() => {
    if (!highlightSessionId || searching || loading) return;
    document.getElementById(`remember-session-${highlightSessionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = window.setTimeout(() => setHighlightSessionId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightSessionId, searching, loading, day]);

  const handleDateChange = (value: string) => {
    if (!value) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === todayIso()) next.delete('date');
      else next.set('date', value);
      return next;
    });
  };

  return (
    <section aria-labelledby="remember-memory-title">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-blue-300/70">Memória cronológica</p>
          <h1 id="remember-memory-title" className="mt-1 text-3xl font-semibold" style={{ color: 'var(--theme-text)' }}>Memória</h1>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <label className="text-xs text-gray-400">Visualizar dia
            <input type="date" value={selectedDate} onChange={(event) => handleDateChange(event.target.value)} className="ml-3 rounded-xl border px-3 py-2 text-sm" style={{ backgroundColor: 'var(--theme-input)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }} />
          </label>
          <input
            id="remember-memory-search"
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Buscar nas memórias…"
            aria-label="Buscar nas memórias"
            className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:border-blue-500 sm:w-72"
            style={{ backgroundColor: 'var(--theme-input)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
          />
        </div>
      </div>
      <RememberRecorderControl />
      <RememberVoiceprintPanel onRelabelChange={refreshAfterRelabel} refreshToken={voiceprintRefreshToken} />
      <section className="mt-6 rounded-[26px] border p-5" style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }} aria-label="Timeline do dia">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold" style={{ color: 'var(--theme-text)' }}>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('pt-BR', { dateStyle: 'long' })}</h2>
          {day && <span className="text-xs text-gray-400">{formatSeconds(day.total_seconds)} · {day.session_count} sessão(ões)</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" checked={onlyMe} onChange={(event) => setOnlyMe(event.target.checked)} />
            Só minhas falas
          </label>
          {onlyMe && (
            <span className="text-[11px] text-blue-300/80">
              💡 Mostrando apenas falas marcadas como suas. Para incluir falas não identificadas, use “→ Minha fala” no bloco.
            </span>
          )}
        </div>
        {searching
          ? <RememberSearchResults query={rawQuery} onOpenDay={openDayFromSearch} />
          : loading ? <p role="status" className="mt-5 text-sm text-gray-500">Carregando memórias…</p>
          : error ? <div role="alert" className="mt-5 rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">{error}<button type="button" onClick={() => void loadDay()} className="ml-3 underline">Tentar novamente</button></div>
          : day?.history_available === false ? <div role="status" className="mt-5 rounded-2xl border border-amber-700/30 bg-amber-950/15 p-4"><p className="text-sm font-medium text-amber-200">Histórico ainda não disponível</p><p className="mt-1 text-sm leading-6 text-gray-400">{day.message}</p></div>
          : !day?.sessions.length ? <p className="mt-5 text-sm text-gray-500">Este dia está disponível, mas ainda não possui sessões registradas.</p>
          : <ol className="mt-5 space-y-4">{[...day.sessions].sort((a, b) => b.started_at.localeCompare(a.started_at)).map((session) => (
            <li key={session.id} id={`remember-session-${session.id}`} className={`rounded-2xl border p-4 transition-colors ${highlightSessionId === session.id ? 'border-blue-400/60 bg-blue-400/10' : ''}`} style={highlightSessionId === session.id ? undefined : { backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sm" style={{ color: 'var(--theme-text)' }}>{formatTime(session.started_at)} — {formatTime(session.ended_at)}</strong><span className="ml-2 text-xs text-gray-500">{sessionDuration(session.started_at, session.ended_at)}</span></div><span className="text-xs text-gray-400">{sessionLabels[session.status]}</span></div>
              {session.progress && session.progress.total > 0 && session.status !== 'ready' && <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-gray-400"><span>Transcrição no PC</span><span>{session.progress.done}/{session.progress.total} blocos · {session.progress.percent}%</span></div>
                <div role="progressbar" aria-label="Progresso da transcrição" aria-valuemin={0} aria-valuemax={100} aria-valuenow={session.progress.percent}
                  className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-blue-400 transition-[width]" style={{ width: `${session.progress.percent}%` }} /></div>
              </div>}
              {session.progress?.models && session.progress.models.length > 0 && (
                <p className="mt-2 text-[11px]" style={{ color: 'var(--theme-muted)' }}>
                  Transcrito no PC com {session.progress.models.join(' + ')}
                </p>
              )}
              <TranscriptDialogue session={session} onlyMe={onlyMe} />
              {session.status === 'ready' && (
                <div aria-label="Ações da sessão" className="mt-4 flex flex-wrap gap-x-4 gap-y-3 border-t pt-4 text-xs" style={{ borderColor: 'var(--theme-border)' }}>
                  <button type="button" onClick={() => void handleCopySession(session)} className="text-blue-300 underline">
                    {copiedSession === session.id ? 'Copiado ✓' : 'Exportar para IA'}
                  </button>
                  <button type="button" onClick={() => downloadSessionMarkdown(session)} className="text-blue-300 underline">
                    Baixar .md
                  </button>
                  {onCreateNote && (
                    <>
                      <button type="button" onClick={() => onCreateNote(noteSeedFromSession(session, 'note'))} className="text-gray-300 underline hover:text-white">
                        ＋ Nota
                      </button>
                      <button type="button" onClick={() => onCreateNote(noteSeedFromSession(session, 'reminder'))} className="text-gray-300 underline hover:text-white">
                        🔔 Lembrete
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleUseSessionAsVoice(session.id)}
                    disabled={voiceRefSession === session.id}
                    className="text-blue-300 underline disabled:opacity-50"
                  >
                    {voiceRefSession === session.id ? 'Definindo referência…' : 'Usar minha voz desta sessão'}
                  </button>
                </div>
              )}
            </li>
          ))}</ol>}
      </section>
    </section>
  );
}
