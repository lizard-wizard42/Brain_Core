import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RememberDay, RememberSession, RememberSpeakerCluster, RememberPerson } from '../../types';
import { rememberService } from '../../services/rememberService';
import { clusterLetter, pendingCount } from './speakerLabels';
import { spTime } from './rememberTime';

function fmtSecs(s: number): string {
  const m = Math.round(s / 60);
  return m >= 1 ? `${m} min` : `${Math.round(s)}s`;
}

/** Um botão que toca um único trecho (play/pausa). `label` sobrescreve o "▶N". */
function ClipButton({ segmentId, label, title }: { segmentId: number; label: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (failed) return <span className="px-1 text-xs text-gray-600">·</span>;
  return (
    <button
      type="button"
      title={title}
      onClick={() => {
        if (!audioRef.current) {
          audioRef.current = new Audio(rememberService.segmentAudioUrl(segmentId));
          audioRef.current.onerror = () => setFailed(true);
        }
        const a = audioRef.current;
        if (a.paused) void a.play().catch(() => setFailed(true));
        else { a.pause(); a.currentTime = 0; }
      }}
      className="rounded px-1.5 py-1 text-xs text-blue-300 hover:bg-white/5"
    >
      {label}
    </button>
  );
}

/** Trechos representativos de um falante: um botão por trecho (▶1 ▶2 ▶3),
 *  cada um toca isolado pra dar pra comparar as vozes. */
function PlayButton({ segmentId, segmentIds }: { segmentId: number | null; segmentIds?: number[] }) {
  const ids = (segmentIds ?? []).filter((id) => Number.isInteger(id) && id > 0);
  const list = ids.length ? ids : (segmentId != null && segmentId > 0 ? [segmentId] : []);
  if (!list.length) return <span className="text-xs text-gray-500">sem áudio</span>;
  if (list.length === 1) {
    return <ClipButton segmentId={list[0]} label="▶" title="Ouvir um trecho" />;
  }
  return (
    <span className="inline-flex gap-1">
      {list.map((id, i) => (
        <ClipButton key={id} segmentId={id} label={`▶${i + 1}`} title={`Ouvir trecho ${i + 1}`} />
      ))}
    </span>
  );
}

function PickPerson({ people, onPick }: { people: RememberPerson[]; onPick: (personId: number) => void }) {
  const [pickId, setPickId] = useState('');
  return (
    <div className="flex gap-2">
      <select value={pickId} onChange={(e) => setPickId(e.target.value)} className="rounded border border-white/10 bg-black/20 px-2 py-1 text-xs text-white">
        <option value="">escolher…</option>
        {people.filter((p) => !p.is_me).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" className="rounded bg-white px-2 text-xs text-black" onClick={() => { if (pickId) onPick(Number(pickId)); }}>OK</button>
    </div>
  );
}

function ClusterRow({ session, sc, people, busy = false, onAction }: {
  session: RememberSession;
  sc: RememberSpeakerCluster;
  people: RememberPerson[];
  busy?: boolean;
  onAction: (action: 'confirm_new' | 'confirm_person' | 'reject' | 'set_me', opts?: { name?: string; personId?: number }) => void;
}) {
  void session;
  const [mode, setMode] = useState<'idle' | 'name' | 'pick'>('idle');
  const [name, setName] = useState('');

  if (sc.status === 'confirmed') {
    return (
      <fieldset disabled={busy} className="flex flex-wrap items-center gap-2 py-1 text-sm disabled:opacity-60">
        <PlayButton segmentId={sc.sample_segment_id} segmentIds={sc.sample_segment_ids} />
        <span className="text-gray-200">{sc.is_me ? 'Você' : sc.name ?? `Falante ${clusterLetter(sc.cluster)}`}</span>
        {!sc.is_me && (
          <button type="button" className="text-xs text-gray-500 underline hover:text-gray-300" onClick={() => setMode((m) => (m === 'pick' ? 'idle' : 'pick'))}>trocar</button>
        )}
        {mode === 'pick' && (
          <PickPerson people={people} onPick={(personId) => onAction('confirm_person', { personId })} />
        )}
      </fieldset>
    );
  }

  return (
    <fieldset disabled={busy} className="space-y-1 border-l border-white/10 py-1 pl-2 text-sm disabled:opacity-60">
      <div className="flex items-center gap-2">
        <PlayButton segmentId={sc.sample_segment_id} segmentIds={sc.sample_segment_ids} />
        <span className="text-gray-300">Falante {clusterLetter(sc.cluster)}</span>
        <span className="text-xs text-gray-500">{sc.turn_count} fala(s)</span>
      </div>
      {sc.suggested && (
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Parece <strong className="text-gray-200">{sc.suggested.name}</strong> · {Math.round(sc.suggested.score * 100)}%</span>
          <button type="button" className="rounded bg-white px-2 py-0.5 text-xs font-medium text-black" onClick={() => onAction('confirm_person', { personId: sc.suggested!.person_id })}>✓ Confirmar</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" className="text-blue-300 underline" onClick={() => setMode('pick')}>Outra pessoa…</button>
        <button type="button" className="text-blue-300 underline" onClick={() => setMode('name')}>Nome novo…</button>
        <button type="button" className="text-gray-300 underline" onClick={() => onAction('set_me')}>Sou eu</button>
        <button type="button" className="text-gray-400 underline" onClick={() => onAction('reject')}>Não é ninguém</button>
      </div>
      {mode === 'name' && (
        <div className="flex gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da pessoa" className="rounded border border-white/10 bg-black/20 px-2 py-1 text-xs text-white" />
          <button type="button" className="rounded bg-white px-2 text-xs text-black" onClick={() => { if (name.trim()) onAction('confirm_new', { name: name.trim() }); }}>OK</button>
        </div>
      )}
      {mode === 'pick' && (
        <PickPerson people={people} onPick={(personId) => onAction('confirm_person', { personId })} />
      )}
    </fieldset>
  );
}

function DaySpeakersTab({ day, people, onChanged }: { day: RememberDay | null; people: RememberPerson[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (session: RememberSession, cluster: number, action: 'confirm_new' | 'confirm_person' | 'reject' | 'set_me', opts?: { name?: string; personId?: number }) => {
    if (busy) return;
    setBusy(`${session.id}:${cluster}`);
    try {
      await rememberService.setCluster(session.id, cluster, action, opts);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar o falante');
      alert(e instanceof Error ? e.message : 'Falha ao salvar o falante');
    } finally {
      setBusy(null);
    }
  };

  const processDay = async () => {
    setBusy('all');
    const failed: string[] = [];
    try {
      for (const s of day?.sessions ?? []) {
        try {
          await rememberService.backfillSpeakers(s.id);
        } catch {
          failed.push(s.id);
        }
      }
      if (failed.length) alert(`Não deu pra processar ${failed.length} sessão(ões).`);
    } finally {
      onChanged();
      setBusy(null);
    }
  };

  if (!day || day.sessions.length === 0) return <p className="text-sm text-gray-500">Sem sessões neste dia.</p>;
  const anySpeakers = day.sessions.some((s) => (s.speakers?.length ?? 0) > 0);

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      {!anySpeakers && (
        <div className="rounded-xl border border-amber-700/30 bg-amber-950/15 p-3">
          <p className="text-sm text-amber-200">Este dia ainda não foi processado.</p>
          <button type="button" disabled={busy === 'all'} onClick={() => void processDay()} className="mt-2 rounded bg-white px-3 py-1 text-xs font-medium text-black disabled:opacity-50">
            {busy === 'all' ? 'Processando…' : 'Processar falantes'}
          </button>
        </div>
      )}
      {day.sessions.map((session) => {
        const nonMe = (session.speakers ?? []).filter((c) => !c.is_me);
        if (!nonMe.length) return null;
        return (
          <div key={session.id}>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {spTime(session.started_at)}
            </p>
            <div className="mt-1 space-y-1">
              {nonMe.map((sc) => (
                <ClusterRow key={sc.cluster} session={session} sc={sc} people={people} busy={busy !== null}
                  onAction={(action, opts) => void act(session, sc.cluster, action, opts)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PersonRow({ person, others, onChanged }: { person: RememberPerson; others: RememberPerson[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [joining, setJoining] = useState(false);
  const [pick, setPick] = useState('');

  const rename = async () => {
    setEditing(false);
    if (name.trim() && name.trim() !== person.name) {
      try { await rememberService.renamePerson(person.id, name.trim()); onChanged(); }
      catch (e) { alert(e instanceof Error ? e.message : 'Falha ao renomear'); setName(person.name); }
    }
  };
  const remove = async () => {
    if (!window.confirm(`Apagar "${person.name}"? As sessões voltam a "falante pendente".`)) return;
    try { await rememberService.deletePerson(person.id); onChanged(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Falha ao apagar'); }
  };
  const merge = async () => {
    if (!pick) return;
    try { await rememberService.mergePeople(person.id, Number(pick)); setJoining(false); setPick(''); onChanged(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Falha ao juntar'); }
  };

  return (
    <div data-testid="person-row" className="border-b border-white/5 py-2 text-sm">
      <div className="flex items-center gap-2">
        <PlayButton segmentId={person.sample_segment_id} segmentIds={person.sample_segment_ids} />
        {editing && !person.is_me ? (
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()}
            onKeyDown={(e) => { if (e.key === 'Enter') void rename(); }}
            className="rounded border border-white/10 bg-black/20 px-2 py-0.5 text-sm text-white" />
        ) : (
          <button type="button" disabled={person.is_me} onClick={() => setEditing(true)} className="text-gray-100 disabled:cursor-default">
            {person.is_me ? 'Você (voz cadastrada)' : person.name}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-gray-500">{person.session_count} sessão(ões) · {fmtSecs(person.sample_seconds)} de voz</p>
      {!person.is_me && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <button type="button" aria-label="Juntar" className="text-blue-300 underline" onClick={() => setJoining((v) => !v)}>Juntar…</button>
          <button type="button" aria-label="Apagar" className="text-gray-400 underline" onClick={() => void remove()}>Apagar</button>
          {joining && (
            <>
              <select role="combobox" value={pick} onChange={(e) => setPick(e.target.value)} className="rounded border border-white/10 bg-black/20 px-1 py-0.5 text-white">
                <option value="">juntar com…</option>
                {others.filter((p) => !p.is_me && p.id !== person.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" className="rounded bg-white px-2 text-black" onClick={() => void merge()}>OK</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PeopleTab({ people, peopleError, onChanged }: { people: RememberPerson[]; peopleError?: boolean; onChanged: () => void }) {
  if (peopleError) return <p className="text-sm text-gray-500">Registro de pessoas não disponível nesta versão do app Android.</p>;
  if (!people.length) return <p className="text-sm text-gray-500">Nenhuma pessoa ainda. Confirme falantes na aba "Falantes do dia".</p>;
  const sorted = [...people].sort(
    (a, b) => Number(b.is_me) - Number(a.is_me) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return <div>{sorted.map((p) => <PersonRow key={p.id} person={p} others={people} onChanged={onChanged} />)}</div>;
}

function SpeakersDrawer({ day, onClose, onChanged }: { day: RememberDay | null; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'day' | 'people'>('day');
  const [people, setPeople] = useState<RememberPerson[]>([]);
  const [peopleError, setPeopleError] = useState(false);

  useEffect(() => {
    rememberService.getPeople()
      .then((list) => { setPeople(list); setPeopleError(false); })
      .catch(() => setPeopleError(true));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = () => {
    onChanged();
    rememberService.getPeople()
      .then((list) => { setPeople(list); setPeopleError(false); })
      .catch(() => {});
  };

  return createPortal(
    <div className="fixed inset-0 z-[200]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute right-0 top-0 h-full w-[min(92vw,420px)] overflow-y-auto border-l border-white/10 bg-[#141414] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-3 text-sm">
            <button type="button" onClick={() => setTab('day')} className={tab === 'day' ? 'text-white' : 'text-gray-500'}>Falantes do dia</button>
            <button type="button" onClick={() => setTab('people')} className={tab === 'people' ? 'text-white' : 'text-gray-500'}>Pessoas</button>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300">Fechar</button>
        </div>
        {tab === 'day'
          ? <DaySpeakersTab day={day} people={people} onChanged={refresh} />
          : <PeopleTab people={people} peopleError={peopleError} onChanged={refresh} />}
      </div>
    </div>,
    document.body,
  );
}

export function RememberSpeakersButton({ day, onChanged }: { day: RememberDay | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const count = pendingCount(day);
  return (
    <>
      <button
        type="button"
        aria-label="Falantes"
        onClick={() => {
          // Speaker clustering finishes after transcription, while a ready day
          // is no longer polled. Refresh before opening so the drawer never
          // shows a stale, empty state that requires a full-page reload.
          onChanged();
          setOpen(true);
        }}
        className="relative rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white hover:border-blue-500"
      >
        ⚙ Falantes
        {count > 0 && (
          <span className="ml-2 rounded-full bg-blue-500 px-1.5 text-xs font-medium text-white">{count}</span>
        )}
      </button>
      {open && <SpeakersDrawer day={day} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}
