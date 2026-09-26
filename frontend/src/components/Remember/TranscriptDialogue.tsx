import { useEffect, useMemo, useState } from 'react';
import type { RememberSession, RememberTurn } from '../../types';
import { rememberService, type ParticipantIdentity, type SegmentParticipants, type ParticipantDecision } from '../../services/rememberService';
import {
  defaultLabelForSpeaker,
  loadSpeakerAliases,
  loadStableTurnSpeakerOverrides,
  loadTurnSpeakerOverrides,
  saveSpeakerAliases,
  saveStableTurnSpeakerOverride,
  saveTurnSpeakerOverride,
  speakerTone,
  type SpeakerAliases,
} from './speakerAliases';

function spokenTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function extractTurns(session: RememberSession): RememberTurn[] {
  if (session.turns && session.turns.length > 0) return session.turns;
  if (!session.text) return [];
  const lines = session.text.split('\n').map((l) => l.trim()).filter(Boolean);
  const parsed: RememberTurn[] = [];
  for (const line of lines) {
    const match = line.match(/^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([A-Za-z0-9_À-ÿ\s]{2,20}):\s*(.+)$/);
    if (match) {
      const label = match[2].trim().toLowerCase();
      const speaker: RememberTurn['speaker'] = label === 'você' || label === 'me' ? 'me' : 'other';
      parsed.push({ speaker, text: match[3].trim() });
    }
  }
  return parsed;
}

function SpeakerTag({
  label,
  onRename,
  isMe,
  onToggleRole,
}: {
  label: string;
  onRename: () => void;
  isMe: boolean;
  onToggleRole: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span aria-hidden="true" className="speaker-avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1">
        {label.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span className="speaker-label min-w-0 truncate text-xs font-semibold">{label}</span>
      <button
        type="button"
        onClick={onRename}
        className="shrink-0 rounded px-1.5 py-1 text-[11px] text-gray-500 hover:bg-white/10 hover:text-white"
        aria-label={`Renomear ${label}`}
        title={`Renomear ${label}`}
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onToggleRole}
        className="shrink-0 rounded bg-white/5 px-2 py-0.5 text-[10px] text-gray-400 hover:bg-white/15 hover:text-white"
        title={isMe ? 'Atribuir a participante' : 'Atribuir como minha fala'}
      >
        {isMe ? '→ Outro' : '→ Minha fala'}
      </button>
    </div>
  );
}

function ParticipantChoice({ sessionId, segmentId }: { sessionId: string; segmentId: number }) {
  const [data, setData] = useState<SegmentParticipants | null>(null);
  const [identities, setIdentities] = useState<ParticipantIdentity[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setOffline(false);
    Promise.all([rememberService.getSegmentParticipants(sessionId, segmentId), rememberService.getParticipantIdentities(sessionId)])
      .then(([result, names]) => { if (active) { setData(result); setIdentities(names); setSelected(names[0]?.id || ''); } })
      .catch(() => { if (active) { setOffline(true); setError('Identificação indisponível. Sem dados em cache para este segmento.'); } });
    return () => { active = false; };
  }, [sessionId, segmentId]);
  const decide = async (action: ParticipantDecision['action'], identityId: string | null = null) => {
    setBusy(true); setError('');
    try {
      const decision = await rememberService.decideSegment(sessionId, segmentId, action, identityId);
      setData((previous) => ({ decision, suggestions: action === 'undo' ? previous?.suggestions || [] : [] }));
      if ((action === 'confirm' || action === 'correct') && identityId) {
        try { await rememberService.createParticipantTemplate(sessionId, segmentId); }
        catch { setError('Decisão salva. Modelo de voz não criado; uma nova sugestão pode demorar.'); }
      }
    } catch { setError('Não foi possível salvar. Tente novamente quando estiver online.'); }
    finally { setBusy(false); }
  };
  const correction = async () => {
    let id = selected;
    if (name.trim()) {
      setBusy(true);
      try {
        const created = await rememberService.createParticipantIdentity(sessionId, name.trim());
        id = created.id;
        setIdentities((previous) => [...previous.filter((item) => item.id !== created.id), created]);
        setName('');
      } catch { setError('Não foi possível criar o participante.'); setBusy(false); return; }
    }
    if (id) await decide('correct', id);
    else setError('Escolha ou crie um participante.');
    setBusy(false);
  };
  const decision = data?.decision;
  const suggestion = !decision || decision.action === 'undo' ? data?.suggestions[0] : null;
  return <div className="mt-2 space-y-2 text-xs" aria-label="Identificação do segmento">
    {offline ? <p className="text-amber-400">{error}</p> : <p className="text-gray-500">{data ? 'Dados atuais do servidor' : 'Consultando identificação…'}</p>}
    {decision && decision.action !== 'undo' && <p className="text-emerald-400">{decision.action === 'ignore' ? 'Sugestão ignorada neste segmento' : `Identificado neste segmento: ${decision.display_name || identities.find((item) => item.id === decision.identity_id)?.display_name || 'Participante'}`}</p>}
    {suggestion && <p>Parece ser {suggestion.display_name} <span className="text-gray-500">(sugestão, sem confirmação)</span></p>}
    {!offline && data && <div className="flex flex-wrap items-center gap-1">
      {suggestion && <button type="button" disabled={busy} onClick={() => decide('confirm', suggestion.identity_id)} className="rounded bg-blue-700 px-2 py-1 text-white">Confirmar</button>}
      {suggestion && <button type="button" disabled={busy} onClick={() => decide('ignore')} className="rounded bg-white/10 px-2 py-1">Ignorar</button>}
      {decision && decision.action !== 'undo' && <button type="button" disabled={busy} onClick={() => decide('undo')} className="rounded bg-white/10 px-2 py-1">Desfazer</button>}
      <select aria-label="Corrigir participante" value={selected} onChange={(event) => setSelected(event.target.value)} className="rounded bg-black/30 p-1" disabled={busy}>
        <option value="">Escolha participante</option>{identities.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}
      </select>
      <input aria-label="Novo participante" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="Novo nome" className="w-24 rounded bg-black/30 p-1" disabled={busy} />
      <button type="button" disabled={busy} onClick={correction} className="rounded bg-white/10 px-2 py-1">Corrigir</button>
    </div>}
    {error && !offline && <p role="alert" className="text-amber-400">{error}</p>}
  </div>;
}

function TranscriptItem({
  sessionId,
  turn,
  label,
  speakerKey,
  onRename,
  editing,
  onSave,
  onCancel,
  onToggleRole,
}: {
  sessionId: string;
  turn: RememberTurn;
  label: string;
  speakerKey: string;
  onRename: () => void;
  editing: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
  onToggleRole: () => void;
}) {
  const isMe = speakerKey === 'me';
  const toneInfo = speakerTone(speakerKey);
  const time = spokenTime(turn.start_at);
  const dataSpeaker = isMe ? 'me' : speakerKey === 'other' ? 'other' : 'unknown';

  return (
    <li
      className="speaker-turn min-w-0 flex"
      data-speaker={dataSpeaker}
      style={{ ['--speaker-tone' as string]: toneInfo.tone }}
    >
      <div className="speaker-card min-w-0 max-w-[92%] rounded-2xl border p-3 sm:max-w-[85%] sm:p-4">
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSave(new FormData(event.currentTarget).get('label')?.toString() || '');
            }}
          >
            <input
              autoFocus
              name="label"
              aria-label={`Novo nome para ${label}`}
              defaultValue={label}
              maxLength={40}
              onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}
              className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/20 px-2 py-2 text-sm text-white"
            />
            <button type="submit" className="min-h-10 rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white">Salvar</button>
          </form>
        ) : (
          <SpeakerTag label={label} onRename={onRename} isMe={isMe} onToggleRole={onToggleRole} />
        )}
        <p className="mt-3 min-w-0 whitespace-pre-wrap break-words text-sm leading-6" style={{ color: 'var(--theme-text)' }}>{turn.text}</p>
        {turn.id != null && speakerKey !== 'me' && <ParticipantChoice sessionId={sessionId} segmentId={turn.id} />}
        {time && <time dateTime={turn.start_at ?? undefined} className="mt-1 block text-right text-[11px] opacity-60">{time}</time>}
      </div>
    </li>
  );
}

export function TranscriptDialogue({ session, onlyMe }: { session: RememberSession; onlyMe: boolean }) {
  const [aliases, setAliases] = useState<SpeakerAliases>(() => loadSpeakerAliases(session.id));
  const [overrides, setOverrides] = useState<Record<number, string>>(() => loadTurnSpeakerOverrides(session.id));
  const [stableOverrides, setStableOverrides] = useState<Record<number, string>>(() => loadStableTurnSpeakerOverrides(session.id));
  const [editing, setEditing] = useState<number | null>(null);

  const rawTurns = useMemo(() => extractTurns(session), [session]);
  const turns = useMemo(() => rawTurns.filter((turn) => turn.text.trim()), [rawTurns]);

  if (!turns.length) {
    if (session.text) return <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-gray-300">{session.text}</p>;
    return <p className="mt-4 text-sm italic text-gray-500">{session.status === 'ready' ? 'Sem fala detectada.' : 'Aguardando transcrição…'}</p>;
  }

  const items = turns.map((turn, index) => {
    const speakerKey = turn.id != null ? stableOverrides[turn.id] || turn.speaker || 'unknown' : overrides[index] || turn.speaker || 'unknown';
    const isMe = speakerKey === 'me';
    const label = aliases[speakerKey] || defaultLabelForSpeaker(speakerKey);
    return { turn, index, speakerKey, isMe, label };
  });

  const shown = onlyMe ? items.filter((item) => item.isMe) : items;
  if (!shown.length) return <p className="mt-4 text-sm italic text-gray-500">Nenhuma fala sua nesta sessão.</p>;

  const saveAlias = (speakerKey: string, value: string) => {
    const label = value.trim().slice(0, 40);
    if (!label) return;
    const next = { ...aliases, [speakerKey]: label };
    setAliases(next);
    setEditing(null);
    saveSpeakerAliases(session.id, next);
  };

  const toggleTurnRole = (index: number, turnId: number | undefined, currentSpeakerKey: string) => {
    const newSpeaker = currentSpeakerKey === 'me' ? 'other' : 'me';
    if (turnId != null) {
      saveStableTurnSpeakerOverride(session.id, turnId, newSpeaker);
      setStableOverrides((prev) => ({ ...prev, [turnId]: newSpeaker }));
    } else {
      saveTurnSpeakerOverride(session.id, index, newSpeaker);
      setOverrides((prev) => ({ ...prev, [index]: newSpeaker }));
    }
  };

  return (
    <ol aria-label="Diálogo transcrito" className="mt-4 space-y-2">
      {shown.map((item) => (
        <TranscriptItem
          sessionId={session.id}
          key={item.index}
          turn={item.turn}
          label={item.label}
          speakerKey={item.speakerKey}
          onRename={() => setEditing(item.index)}
          editing={editing === item.index}
          onSave={(value) => saveAlias(item.speakerKey, value)}
          onCancel={() => setEditing(null)}
          onToggleRole={() => toggleTurnRole(item.index, item.turn.id, item.speakerKey)}
        />
      ))}
    </ol>
  );
}
