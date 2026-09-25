import { useCallback, useEffect, useRef, useState } from 'react';
import type { RememberSearchResult } from '../../types';
import { rememberService } from '../../services/rememberService';
import { spIsoDateLong, spTime } from './rememberTime';

const STATUS_LABELS: Record<string, string> = {
  recording: 'Gravando', syncing: 'Sincronizando…', processing: 'Processando…',
  transcribing: 'Transcrição sendo processada…', ready: 'Pronta', error: 'Erro no processamento',
};

const formatTime = spTime;
const formatDate = spIsoDateLong;

function renderSnippet(snippet: string) {
  //  (STX) and  (ETX) are the Celtwo snippet delimiters around each match.
  // eslint-disable-next-line no-control-regex -- STX/ETX are the Celtwo snippet match delimiters
  return snippet.split(/[\u0002\u0003]/).map((part, index) =>
    index % 2 === 1
      ? <mark key={index} className="rounded bg-amber-300/30 px-0.5 text-amber-100">{part}</mark>
      : <span key={index}>{part}</span>,
  );
}

function TranscriptToggle({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (!next || loaded.current) return;
    setLoading(true); setError(null);
    try {
      const transcript = await rememberService.getTranscript(sessionId);
      loaded.current = true;
      setText(transcript.text ?? (STATUS_LABELS[transcript.status] ?? 'Sem transcrição.'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar a transcrição');
    } finally {
      setLoading(false);
    }
  }, [open, sessionId]);

  return (
    <div className="mt-2">
      <button type="button" onClick={() => void toggle()} className="text-xs text-blue-300 underline">
        {open ? 'Ocultar transcrição completa' : 'Ver transcrição completa'}
      </button>
      {open && loading && <p className="mt-1 text-xs text-gray-500">Carregando transcrição…</p>}
      {open && error && <p role="alert" className="mt-1 text-xs text-red-300">{error}</p>}
      {open && !loading && !error && text && <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-300">{text}</p>}
    </div>
  );
}

export function RememberSearchResults({ query, onOpenDay }: { query: string; onOpenDay: (date: string, sessionId: string) => void }) {
  const [results, setResults] = useState<RememberSearchResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true); setError(null);
    try {
      const response = await rememberService.search(query);
      if (id === requestId.current) setResults(response.results);
    } catch (reason) {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message : 'Falha na busca');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => { void run(); }, [run]);

  if (loading) return <p role="status" className="mt-5 text-sm text-gray-500">Buscando memórias…</p>;
  if (error) return (
    <div role="alert" className="mt-5 rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">
      {error}<button type="button" onClick={() => void run()} className="ml-3 underline">Tentar novamente</button>
    </div>
  );
  if (!results?.length) return <p className="mt-5 text-sm text-gray-500">Nenhuma memória encontrada para “{query}”.</p>;

  return (
    <ol className="mt-5 space-y-4">
      {results.map((result) => (
        <li key={result.session_id} className="rounded-2xl border border-white/8 bg-white/[0.035] p-4">
          <button type="button" onClick={() => onOpenDay(result.date, result.session_id)} className="block w-full text-left">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm text-white">{formatDate(result.date)} · {formatTime(result.started_at)}</strong>
              <span className="text-xs text-gray-400">{STATUS_LABELS[result.status] ?? result.status} · {result.match_count} ocorrência(s)</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-300">…{renderSnippet(result.snippet)}…</p>
          </button>
          <TranscriptToggle sessionId={result.session_id} />
        </li>
      ))}
    </ol>
  );
}
