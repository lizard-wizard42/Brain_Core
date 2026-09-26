import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { CurrentUser } from '../../api/client';
import type { PageSummary, RememberDay, RememberNote, RememberSession } from '../../types';
import { rememberService } from '../../services/rememberService';
import { NotasBoard } from '../Notas/NotasBoard';
import { useNotas } from '../Notas/useNotas';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

function saoPauloDate(instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(instant);
}

function nextUtcDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

function relative(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `há ${hrs} h`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.round(days / 30);
  return months < 12 ? `há ${months} ${months === 1 ? 'mês' : 'meses'}` : `há ${Math.round(months / 12)} ano(s)`;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function sessionMeta(session: RememberSession): string {
  const end = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
  const dur = formatDuration(Math.max(0, Math.round((end - new Date(session.started_at).getTime()) / 1000)));
  const day = saoPauloDate(new Date(session.started_at));
  const suffix = day !== saoPauloDate() ? ` · ${day.split('-').reverse().join('/')}` : '';
  return dur + suffix;
}

const RECALL_TARGETS = [
  { label: 'Há 1 ano', days: 365, window: 20 },
  { label: 'Há 3 meses', days: 91, window: 12 },
  { label: 'Há 1 semana', days: 7, window: 3 },
];

function pickRecall(notes: RememberNote[]) {
  const now = Date.now();
  const used = new Set<string>();
  return RECALL_TARGETS.map(({ label, days, window }) => {
    const target = now - days * 86400000;
    let best: RememberNote | null = null;
    let bestGap = window * 86400000;
    for (const note of notes) {
      if (used.has(note.id)) continue;
      const gap = Math.abs(new Date(note.created_at).getTime() - target);
      if (gap <= bestGap) { best = note; bestGap = gap; }
    }
    if (best) used.add(best.id);
    return best ? { label, note: best } : null;
  }).filter((x): x is { label: string; note: RememberNote } => x !== null);
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[#2a2a2a] bg-[#1e1e1e] p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-[#2a2a2a] bg-[#1e1e1e] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-400">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DashboardHome({ onOpenPage }: { onOpenPage: (page: { id: string; title: string; icon?: string | null }) => void }) {
  const navigate = useNavigate();
  const { notes, loading, error, createNote, saveNote, deleteNote } = useNotas();
  const [todayIso, setTodayIso] = useState(saoPauloDate);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loadedDay, setToday] = useState<RememberDay | null>(null);
  const today = loadedDay?.date === todayIso ? loadedDay : null;

  useEffect(() => {
    const timer = window.setInterval(() => setTodayIso(saoPauloDate()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    api.getMe().then(setUser).catch(() => undefined);
    api.getTree().then((r) => setPages(r.pages ?? [])).catch(() => undefined);
    // The memory service indexes UTC dates. A São Paulo day can span two
    // UTC dates, so fetch both and keep only sessions from the local day.
    Promise.all([rememberService.getDay(todayIso), rememberService.getDay(nextUtcDate(todayIso))])
      .then(([first, second]) => {
        if (!active) return;
        const sessions = [...first.sessions, ...second.sessions]
          .filter((session) => saoPauloDate(new Date(session.started_at)) === todayIso);
        const total_seconds = sessions.reduce((sum, session) => session.ended_at
          ? sum + Math.max(0, Math.round((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000)) : sum, 0);
        setToday({ date: todayIso, sessions, session_count: sessions.length, total_seconds });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [todayIso]);

  const memories = useMemo(
    () => (today?.sessions ?? [])
      .slice()
      .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [today],
  );

  const recentPages = useMemo(
    () => [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5),
    [pages],
  );

  const recall = useMemo(() => pickRecall(notes), [notes]);

  return (
    <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#191919]">
      <div className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold text-white">
            {greeting()}{user?.name?.trim() ? `, ${user.name.trim()}` : ''}
          </h1>
          <p className="mt-1 text-sm text-gray-500">Aqui está o resumo do seu dia no Brain Core.</p>
        </header>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Memórias hoje" value={String(today?.session_count ?? 0)} hint="gravações" />
          <StatCard label="Tempo gravado" value={formatDuration(today?.total_seconds ?? 0)} hint="hoje" />
          <StatCard
            label="Foco do dia"
            value={recentPages[0]?.title ?? '—'}
            hint={recentPages[0] ? `editado ${relative(recentPages[0].updated_at)}` : 'sem atividade recente'}
          />
          <StatCard label="Total de memórias" value={notes.length.toLocaleString('pt-BR')} hint="notas registradas" />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Memórias de hoje"
            action={
              <button
                type="button"
                onClick={() => navigate(`/remember?date=${todayIso}`)}
                className="text-xs text-gray-400 hover:text-white"
              >
                Ver dia →
              </button>
            }
          >
            {memories.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhuma gravação ainda.</p>
            ) : (
              <ol className="space-y-3">
                {memories.slice(0, 8).map((session) => (
                  <li key={session.id} className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 font-mono text-xs text-gray-500">{hhmm(session.started_at)}</span>
                    <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${session.status === 'ready' ? 'bg-emerald-500' : session.status === 'error' ? 'bg-red-500' : 'bg-gray-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-200">
                        {session.text?.trim() || (session.status === 'ready' ? 'Sem transcrição' : 'Processando…')}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">{sessionMeta(session)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Continuar de onde parou" action={<span className="text-xs text-gray-600">{recentPages.length}</span>}>
            {recentPages.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhuma página editada recentemente.</p>
            ) : (
              <ul className="space-y-2">
                {recentPages.map((page) => (
                  <li key={page.id}>
                    <button
                      type="button"
                      onClick={() => onOpenPage(page)}
                      className="flex w-full items-center gap-3 rounded-lg border border-[#242424] bg-[#191919] px-3 py-2.5 text-left hover:border-[#3a3a3a]"
                    >
                      <span aria-hidden="true" className="text-base">{page.icon || '📄'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-gray-200">{page.title}.md</span>
                        <span className="block text-xs text-gray-500">Editado {relative(page.updated_at)}</span>
                      </span>
                      <span aria-hidden="true" className="text-gray-600">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {recall.length > 0 && (
          <section className="mt-6 rounded-2xl border border-[#2a2a2a] bg-[#1e1e1e] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-gray-400">
              <span aria-hidden="true">🧠</span> Lembrado pelo Brain
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {recall.map(({ label, note }) => (
                <div key={label} className="rounded-xl border border-[#242424] bg-[#191919] p-4">
                  <p className="text-xs font-medium text-gray-400">{label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{note.created_at.slice(0, 10).split('-').reverse().join('/')}</p>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-300">{note.title || note.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-gray-400">Notas</h2>
          <NotasBoard notes={notes} loading={loading} error={error} onCreate={createNote} onSave={saveNote} onDelete={deleteNote} />
        </section>
      </div>
    </div>
  );
}
