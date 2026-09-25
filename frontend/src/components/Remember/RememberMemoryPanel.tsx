import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import type { RememberDay, RememberPerson, RememberSession, RememberSpeakerCluster, RememberTurn } from '../../types';
import { rememberService } from '../../services/rememberService';
import { RememberRecorderControl } from './RememberRecorderControl';
import { RememberSearchResults } from './RememberSearchResults';
import { RememberVoiceprintPanel } from './RememberVoiceprintPanel';
import { copySessionMarkdown, downloadSessionMarkdown } from './rememberExport';
import { onRememberStatus, REMEMBER_PENDING_STATES } from './rememberEvents';
import { clusterLabel, isMyTurn, personTint } from './speakerLabels';
import { RememberSpeakersButton } from './RememberSpeakersPanel';
import { emptyDraft, type NoteDraft } from '../Notas/notasModel';
import { SP_TZ, spDateTimeShort, spIsoDateLong, spTime, spTodayIso } from './rememberTime';

function noteSeedFromSession(session: RememberSession, kind: 'note' | 'reminder'): NoteDraft {
  const when = spDateTimeShort(session.started_at);
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

const todayIso = spTodayIso;

const formatTime = spTime;

function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes} min`;
}

function sessionDuration(session: RememberSession): string {
  const secs = session.duration_seconds
    ?? Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000));
  return formatSeconds(secs);
}

/** end-of-recording clock, derived from the real duration (ended_at from the
 *  server is just when the completion POST landed — often hours off). */
function sessionEndClock(session: RememberSession): string {
  if (session.duration_seconds == null) return formatTime(session.ended_at);
  return formatTime(new Date(new Date(session.started_at).getTime() + session.duration_seconds * 1000).toISOString());
}

function turnClock(session: RememberSession, turn: RememberTurn): string | null {
  if (turn.start_ms == null) return null;
  return new Date(new Date(session.started_at).getTime() + turn.start_ms).toLocaleTimeString('pt-BR', {
    timeZone: SP_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const sessionLabels: Record<string, string> = {
  recording: 'Gravando', syncing: 'Sincronizando…', processing: 'Processando…',
  transcribing: 'Transcrição sendo processada…', ready: 'Pronta', error: 'Erro no processamento',
};

const AUTO_NAME_CONFIDENCE = 0.95;

function isHighConfidenceSuggestion(speaker: RememberSpeakerCluster | undefined): boolean {
  return speaker?.status === 'pending'
    && speaker.suggested != null
    && speaker.suggested.score >= AUTO_NAME_CONFIDENCE;
}

function InlineSpeakerModal({ session, speaker, onClose, onChanged }: {
  session: RememberSession;
  speaker: RememberSpeakerCluster;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [people, setPeople] = useState<RememberPerson[]>([]);
  const [personId, setPersonId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void rememberService.getPeople().then(setPeople).catch(() => setError('Não foi possível carregar as pessoas.'));
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const save = async (
    action: 'confirm_new' | 'confirm_person' | 'set_me',
    opts?: { name?: string; personId?: number },
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await rememberService.setCluster(session.id, speaker.cluster, action, opts);
      onChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível identificar esta voz.');
      setBusy(false);
    }
  };

  const currentLabel = speaker.is_me
    ? 'Você'
    : speaker.name ?? (isHighConfidenceSuggestion(speaker) ? speaker.suggested!.name : `Falante ${String.fromCharCode(64 + Math.max(1, speaker.cluster))}`);
  const sampleIds = (speaker.sample_segment_ids?.length
    ? speaker.sample_segment_ids
    : speaker.sample_segment_id != null ? [speaker.sample_segment_id] : [])
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 3);
  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="identify-speaker-title" className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#181818] p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-blue-300/70">Identificar voz</p>
            <h3 id="identify-speaker-title" className="mt-1 text-base font-semibold text-white">Quem é {currentLabel}?</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-white/5 hover:text-white">Fechar</button>
        </div>

        {sampleIds.length > 0 ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs font-medium text-gray-300">Ouça antes de identificar</p>
            <div className="space-y-2">
              {sampleIds.map((segmentId, index) => (
                <div key={segmentId} className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
                  <span className="text-xs text-gray-500">Exemplo {index + 1}</span>
                  <audio aria-label={`Exemplo de voz ${index + 1}`} controls preload="none" src={rememberService.segmentAudioUrl(segmentId)} className="h-8 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs text-gray-500">Ainda não há um trecho de áudio disponível para esta voz.</p>
        )}

        {speaker.suggested && !speaker.is_me && (
          <button type="button" disabled={busy} onClick={() => void save('confirm_person', { personId: speaker.suggested!.person_id })} className="mt-4 w-full rounded-xl border border-blue-400/20 bg-blue-400/10 p-3 text-left text-sm text-blue-100 disabled:opacity-50">
            Parece <strong>{speaker.suggested.name}</strong> · {Math.round(speaker.suggested.score * 100)}% <span className="float-right text-blue-300">Confirmar</span>
          </button>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="inline-speaker-person" className="text-xs text-gray-400">Pessoa já cadastrada</label>
            <div className="mt-1 flex gap-2">
              <select id="inline-speaker-person" value={personId} onChange={(event) => setPersonId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-white">
                <option value="">Escolher pessoa…</option>
                {people.filter((person) => !person.is_me).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
              <button type="button" disabled={busy || !personId} onClick={() => void save('confirm_person', { personId: Number(personId) })} className="rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-40">Associar</button>
            </div>
          </div>

          <div>
            <label htmlFor="inline-speaker-name" className="text-xs text-gray-400">Ou cadastrar um novo nome</label>
            <div className="mt-1 flex gap-2">
              <input id="inline-speaker-name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) void save('confirm_new', { name: name.trim() }); }} placeholder="Nome da pessoa" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-blue-400" />
              <button type="button" disabled={busy || !name.trim()} onClick={() => void save('confirm_new', { name: name.trim() })} className="rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-40">Salvar</button>
            </div>
          </div>
        </div>

        <button type="button" disabled={busy} onClick={() => void save('set_me')} className="mt-4 w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-200 hover:bg-white/5 disabled:opacity-50">Esta voz sou eu</button>
        {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}

function SessionBody({ session, onlyMe, onChanged }: { session: RememberSession; onlyMe: boolean; onChanged: () => void }) {
  const [editingSpeaker, setEditingSpeaker] = useState<RememberSpeakerCluster | null>(null);
  const turns: RememberTurn[] = (session.turns ?? []).filter((turn) => turn.text.trim());
  const labelled = turns.filter((turn) => turn.speaker);
  if (!labelled.length) {
    if (session.text) return <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-300">{session.text}</p>;
    return <p className="mt-3 text-sm italic text-gray-500">{session.status === 'ready' ? 'Sem transcrição.' : sessionLabels[session.status]}</p>;
  }
  const shown = onlyMe ? turns.filter((turn) => isMyTurn(session, turn)) : turns;
  if (!shown.length) return <p className="mt-3 text-sm italic text-gray-500">Nenhuma fala sua nesta sessão.</p>;
  return (
    <div className="relative mt-4 space-y-1 border-l border-blue-400/20 pl-4">
      <div className="relative pb-2 text-[11px] font-medium uppercase tracking-wider text-blue-300/80">
        <span className="absolute -left-[1.19rem] top-1 h-2 w-2 rounded-full bg-blue-400 ring-4 ring-[#171717]" />
        Início da sessão · {formatTime(session.started_at)}
      </div>
      {shown.map((turn, index) => {
        const label = clusterLabel(session, turn.cluster, turn.speaker);
        const sc = session.speakers?.find((s) => s.cluster === turn.cluster);
        const highConfidence = isHighConfidenceSuggestion(sc);
        const displayLabel = highConfidence ? sc!.suggested!.name : label;
        const bodyColor = isMyTurn(session, turn)
          ? 'text-gray-100'
          : sc?.status === 'confirmed' ? personTint(sc.person_id)
            : highConfidence ? personTint(sc!.suggested!.person_id) : 'text-gray-400';
        const clock = turnClock(session, turn);
        return (
          <div key={index} className="relative grid grid-cols-[4.75rem_1fr] gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.035]">
            <span className="absolute -left-[1.34rem] top-3 h-1.5 w-1.5 rounded-full bg-gray-600" />
            <time className="pt-0.5 font-mono text-[11px] tabular-nums text-gray-500">{clock ?? '—'}</time>
            <p className={`text-sm leading-6 ${bodyColor}`}>
              {sc ? (
                <button type="button" title="Identificar ou corrigir esta pessoa" onClick={() => setEditingSpeaker(sc)} className="mr-2 rounded-md border border-transparent px-1 py-0.5 text-xs uppercase tracking-wide text-gray-500 underline decoration-dotted underline-offset-2 hover:border-white/10 hover:bg-white/5 hover:text-blue-300">
                  {displayLabel}{highConfidence && <span className="ml-1 normal-case tracking-normal text-[10px] text-emerald-400/80">provável · {Math.round(sc.suggested!.score * 100)}%</span>}
                </button>
              ) : (
                <span className="mr-2 text-xs uppercase tracking-wide text-gray-500">{label}</span>
              )}
              {turn.text}
            </p>
          </div>
        );
      })}
      <div className="relative pt-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
        <span className="absolute -left-[1.19rem] top-3 h-2 w-2 rounded-full border border-gray-500 bg-[#171717]" />
        Fim da sessão · {sessionEndClock(session)}
      </div>
      {editingSpeaker && <InlineSpeakerModal session={session} speaker={editingSpeaker} onClose={() => setEditingSpeaker(null)} onChanged={onChanged} />}
    </div>
  );
}

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
  const handleUseSessionAsVoice = useCallback(async (sessionId: string) => {
    setVoiceRefSession(sessionId);
    try {
      await rememberService.enrollVoiceprintFromSession(sessionId);
      window.setTimeout(() => { void loadDay({ silent: true }); }, 4000);
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
          <h1 id="remember-memory-title" className="mt-1 text-3xl font-semibold text-white">Memória</h1>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <label className="text-xs text-gray-400">Visualizar dia
            <input type="date" value={selectedDate} onChange={(event) => handleDateChange(event.target.value)} className="ml-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" />
          </label>
          <RememberSpeakersButton day={day} onChanged={() => { void loadDay({ silent: true }); }} />
          <input
            id="remember-memory-search"
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Buscar nas memórias…"
            aria-label="Buscar nas memórias"
            className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-white outline-none focus:border-blue-500 sm:w-72"
          />
        </div>
      </div>
      <RememberRecorderControl />
      <RememberVoiceprintPanel />
      <section className="mt-6 rounded-[26px] border border-white/10 bg-black/15 p-5" aria-label="Timeline do dia">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-white">{spIsoDateLong(selectedDate)}</h2>
          {day && <span className="text-xs text-gray-400">{formatSeconds(day.total_seconds)} · {day.session_count} sessão(ões)</span>}
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={onlyMe} onChange={(event) => setOnlyMe(event.target.checked)} />
          Só minhas falas
        </label>
        {!searching && day?.sessions.length ? (
          <p className="mt-3 text-xs text-gray-500" aria-label="Ordem da linha do tempo">
            ↓ Sessões mais recentes primeiro; dentro de cada sessão, as falas seguem do início ao fim.
          </p>
        ) : null}
        {searching
          ? <RememberSearchResults query={rawQuery} onOpenDay={openDayFromSearch} />
          : loading ? <p role="status" className="mt-5 text-sm text-gray-500">Carregando memórias…</p>
          : error ? <div role="alert" className="mt-5 rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">{error}<button type="button" onClick={() => void loadDay()} className="ml-3 underline">Tentar novamente</button></div>
          : day?.history_available === false ? <div role="status" className="mt-5 rounded-2xl border border-amber-700/30 bg-amber-950/15 p-4"><p className="text-sm font-medium text-amber-200">Histórico ainda não disponível</p><p className="mt-1 text-sm leading-6 text-gray-400">{day.message}</p></div>
          : !day?.sessions.length ? <p className="mt-5 text-sm text-gray-500">Este dia está disponível, mas ainda não possui sessões registradas.</p>
          : <ol className="mt-5 space-y-4">{[...day.sessions].sort((a, b) => b.started_at.localeCompare(a.started_at)).map((session) => (
            <li key={session.id} id={`remember-session-${session.id}`} className={`rounded-2xl border p-4 transition-colors ${highlightSessionId === session.id ? 'border-blue-400/60 bg-blue-400/10' : 'border-white/8 bg-white/[0.035]'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-white"><span className="text-blue-300">Início</span> {formatTime(session.started_at)} <span className="mx-1 text-gray-600">→</span> <span className="text-gray-400">Fim</span> {sessionEndClock(session)}</strong><span className="text-xs text-gray-500">{sessionDuration(session)}</span></div><span className="text-xs text-gray-400">{sessionLabels[session.status]}</span></div>
              {session.status === 'ready' && (
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
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
              <SessionBody session={session} onlyMe={onlyMe} onChanged={() => { void loadDay({ silent: true }); }} />
            </li>
          ))}</ol>}
      </section>
    </section>
  );
}
