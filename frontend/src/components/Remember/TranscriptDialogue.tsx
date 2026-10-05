import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
    <details className="conversation-identity">
      <summary className="conversation-disclosure">Editar participante</summary>
      <div className="conversation-identity-body flex flex-wrap gap-2">
        {!isMe && <button type="button" onClick={onRename} className="conversation-button" aria-label={`Renomear ${label}`}>Renomear</button>}
        <button type="button" onClick={onToggleRole} className="conversation-button">{isMe ? '→ Outro' : '→ Minha fala'}</button>
      </div>
    </details>
  );
}

function ParticipantChoice({ sessionId, segmentId, onDecision }: { sessionId: string; segmentId: number; onDecision: (id: number, decision: ParticipantDecision | null) => void }) {
  const [data, setData] = useState<SegmentParticipants | null>(null);
  const [identities, setIdentities] = useState<ParticipantIdentity[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setOffline(false);
    Promise.all([rememberService.getSegmentParticipants(sessionId, segmentId), rememberService.getParticipantIdentities(sessionId)])
      .then(([result, names]) => { if (active) { setData(result); setIdentities(names); setSelected(result.decision?.identity_id || names[0]?.id || ''); onDecision(segmentId, result.decision); } })
      .catch(() => { if (active) { setOffline(true); onDecision(segmentId, null); setError('Identificação indisponível. Sem dados em cache para este segmento.'); } });
    return () => { active = false; };
  }, [sessionId, segmentId, refresh, onDecision]);
  const decide = async (action: ParticipantDecision['action'], identityId: string | null = null, displayName?: string) => {
    setBusy(true); setError('');
    try {
      const saved = await rememberService.decideSegment(sessionId, segmentId, action, identityId);
      const decision = { ...saved, display_name: saved.display_name || displayName || identities.find(item => item.id === saved.identity_id)?.display_name };
      onDecision(segmentId, decision);
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
    if (id) { setSelected(id); await decide('correct', id, name.trim() || undefined); }
    else setError('Escolha ou crie um participante.');
    setBusy(false);
  };
  const decision = data?.decision;
  const suggestion = !decision || decision.action === 'undo' ? data?.suggestions[0] : null;
  const confirmed = decision?.action === 'confirm' || decision?.action === 'correct';
  const identityLabel = (id: string | null | undefined, fallback?: string | null) =>
    identities.find(item => item.id === id)?.is_owner || (id === decision?.identity_id && decision?.is_owner)
      ? 'Eu' : fallback || identities.find(item => item.id === id)?.display_name || 'Participante';
  return <details className="conversation-identity">
    <summary className="conversation-disclosure">
      {confirmed ? 'Alterar participante' : 'Identificar fala'}
      {suggestion && <span className="conversation-suggestion-dot" title="Sugestão disponível" />}
    </summary>
    <div className="conversation-identity-body space-y-3" aria-label="Identificação do segmento">
      {!data && !offline && <p role="status">Consultando identificação…</p>}
      {decision && decision.action !== 'undo' && <p>{decision.action === 'ignore' ? 'Sugestão ignorada neste segmento' : `Identificado: ${identityLabel(decision.identity_id, decision.display_name)}`}</p>}
      {suggestion && <div className="space-y-2"><p>Sugestão: <strong>{identityLabel(suggestion.identity_id, suggestion.display_name)}</strong></p><div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => decide('confirm', suggestion.identity_id)} className="conversation-button conversation-button-primary">Confirmar</button>
        <button type="button" disabled={busy} onClick={() => decide('ignore')} className="conversation-button">Ignorar</button>
      </div></div>}
      {data?.suggestions_status && data.suggestions_status !== 'ready' && <p>
        {data.suggestions_status === 'busy' ? 'Sugestões em processamento. Você pode identificar manualmente.' : 'Sugestões indisponíveis. Você pode identificar manualmente.'}
      </p>}
      {(offline || (data?.suggestions_status && data.suggestions_status !== 'ready')) && <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)} className="conversation-button">Atualizar identificação</button>}
      {!offline && data && <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void correction(); }}>
        <select aria-label="Corrigir participante" value={selected} onChange={event => setSelected(event.target.value)} className="conversation-input" disabled={busy}>
          <option value="">Escolha participante</option>{identities.map(item => <option key={item.id} value={item.id}>{identityLabel(item.id, item.display_name)}</option>)}
        </select>
        <input aria-label="Novo participante" value={name} maxLength={40} onChange={event => setName(event.target.value)} placeholder="Ou novo nome" className="conversation-input w-36" disabled={busy} />
        <button type="submit" disabled={busy} className="conversation-button">Corrigir</button>
        {decision && decision.action !== 'undo' && <button type="button" disabled={busy} onClick={() => decide('undo')} className="conversation-button">Desfazer</button>}
      </form>}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
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
  onDecision,
  confirmed,
  hidden,
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
  onDecision: (id: number, decision: ParticipantDecision | null) => void;
  confirmed: boolean;
  hidden: boolean;
}) {
  const isMe = speakerKey === 'me';
  const toneInfo = speakerTone(speakerKey);
  const time = spokenTime(turn.start_at);
  const dataSpeaker = isMe ? 'me' : speakerKey !== 'unknown' ? 'other' : 'unknown';

  return (
    <li
      hidden={hidden}
      className={`speaker-turn min-w-0 ${hidden ? 'hidden' : 'flex'}`}
      data-speaker={dataSpeaker}
      style={{ ['--speaker-tone' as string]: toneInfo.tone }}
    >
      <div className="speaker-card conversation-bubble">
        <div className="conversation-message-heading"><span className="speaker-label">{label}</span></div>
        <p className="conversation-message-text">{turn.text}</p>
        {time && <time dateTime={turn.start_at ?? undefined} className="conversation-time">{time}</time>}
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
              className="conversation-input min-w-0 flex-1"
            />
            <button type="submit" className="min-h-10 rounded-lg bg-blue-700 px-3 text-xs font-semibold text-white">Salvar</button>
          </form>
        ) : (
          !confirmed && turn.id == null && <SpeakerTag label={label} onRename={onRename} isMe={isMe} onToggleRole={onToggleRole} />
        )}
        {turn.id != null && <ParticipantChoice sessionId={sessionId} segmentId={turn.id} onDecision={onDecision} /> }
      </div>
    </li>
  );
}

interface DialogueProps { session: RememberSession; onlyMe: boolean; onLabelsChange?: (labels: Record<number, string>) => void }

function DialogueSession({ session, onlyMe, onLabelsChange }: DialogueProps) {
  const [aliases, setAliases] = useState<SpeakerAliases>(() => loadSpeakerAliases(session.id));
  const [overrides, setOverrides] = useState<Record<number, string>>(() => loadTurnSpeakerOverrides(session.id));
  const [stableOverrides, setStableOverrides] = useState<Record<number, string>>(() => loadStableTurnSpeakerOverrides(session.id));
  const [editing, setEditing] = useState<number | null>(null);

  const [decisions, setDecisions] = useState<Record<number, ParticipantDecision | null>>({});
  const onDecision = useCallback((id: number, decision: ParticipantDecision | null) => {
    setDecisions(previous => ({ ...previous, [id]: decision }));
  }, []);
  const rawTurns = useMemo(() => extractTurns(session), [session]);
  const turns = useMemo(() => rawTurns.filter((turn) => turn.text.trim()), [rawTurns]);

  const items = useMemo(() => turns.map((turn, index) => {
    const decision = turn.id != null ? decisions[turn.id] : null;
    const confirmed = !!decision?.identity_id && (decision.action === 'confirm' || decision.action === 'correct');
    const fallbackSpeaker = turn.id != null ? stableOverrides[turn.id] || turn.speaker || 'unknown' : overrides[index] || turn.speaker || 'unknown';
    const speakerKey = confirmed ? (decision.is_owner ? 'me' : `identity:${decision.identity_id}`) : fallbackSpeaker;
    const isMe = speakerKey === 'me';
    const label = isMe ? 'Eu' : confirmed ? decision.display_name || 'Participante' : aliases[speakerKey] || defaultLabelForSpeaker(speakerKey);
    return { turn, index, speakerKey, isMe, label, confirmed };
  }), [turns, decisions, stableOverrides, overrides, aliases]);

  useLayoutEffect(() => {
    onLabelsChange?.(Object.fromEntries(items.map(item => [item.index, item.label])));
  }, [items, onLabelsChange]);

  if (!turns.length) {
    if (session.text) return <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-gray-300">{session.text}</p>;
    return <p className="mt-4 text-sm italic text-gray-500">{session.status === 'ready' ? 'Sem fala detectada.' : 'Aguardando transcrição…'}</p>;
  }

  const shown = onlyMe ? items.filter((item) => item.isMe) : items;
  const pending = items.some(item => item.turn.id != null && decisions[item.turn.id] === undefined);

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
    <>
    {onlyMe && !shown.length && <p role="status" className="mt-4 text-sm italic text-gray-500">{pending ? 'Consultando identificação das falas…' : 'Nenhuma fala sua nesta sessão.'}</p>}
    <ol aria-label="Diálogo transcrito" className="conversation-messages">
      {items.map((item) => (
        <TranscriptItem
          sessionId={session.id}
          onDecision={onDecision}
          confirmed={item.confirmed}
          hidden={onlyMe && !item.isMe}
          key={item.turn.id ?? item.index}
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
    </>
  );
}

export function TranscriptDialogue(props: DialogueProps) {
  return <DialogueSession key={props.session.id} {...props} />;
}
