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

const STATUS_LABEL: Record<RememberSession['status'], string> = {
  recording: 'Gravando',
  syncing: 'Sincronizando',
  processing: 'Processando',
  transcribing: 'Transcrevendo',
  ready: 'Transcrição pronta',
  error: 'Erro na transcrição',
};

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

function StatCard({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`h-full w-full min-w-0 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 text-left ${onClick ? 'hover:bg-[var(--theme-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)]' : ''}`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--theme-muted)]">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold text-[var(--theme-text)]">{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--theme-muted)]">{hint}</p>}
    </Tag>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)]">{title}</h2>
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
  const [pagesAttempt, retryPages] = useState(0);
  const [memoryAttempt, retryMemories] = useState(0);
  const [pageResult, setPages] = useState<{ attempt: number; pages: PageSummary[]; error: boolean } | null>(null);
  const [dayResult, setDay] = useState<{ date: string; attempt: number; day: RememberDay | null; error: boolean } | null>(null);
  const pagesLoading = pageResult?.attempt !== pagesAttempt;
  const pagesError = !pagesLoading && pageResult?.error;
  const pages = !pagesLoading && !pagesError ? pageResult?.pages ?? [] : [];
  const memoriesLoading = dayResult?.date !== todayIso || dayResult?.attempt !== memoryAttempt;
  const memoriesError = !memoriesLoading && dayResult?.error;
  const today = !memoriesLoading && !memoriesError ? dayResult?.day : null;

  useEffect(() => {
    const timer = window.setInterval(() => setTodayIso(saoPauloDate()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    api.getMe().then(value => { if (active) setUser(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api.getTree()
      .then(r => { if (active) setPages({ attempt: pagesAttempt, pages: r.pages ?? [], error: false }); })
      .catch(() => { if (active) setPages({ attempt: pagesAttempt, pages: [], error: true }); });
    return () => { active = false; };
  }, [pagesAttempt]);

  useEffect(() => {
    let active = true;
    // The memory service indexes UTC dates. A São Paulo day can span two
    // UTC dates, so fetch both and keep only sessions from the local day.
    Promise.all([rememberService.getDay(todayIso), rememberService.getDay(nextUtcDate(todayIso))])
      .then(([first, second]) => {
        if (!active) return;
        const byId = new Map([...first.sessions, ...second.sessions].map((session) => [session.id, session]));
        const sessions = [...byId.values()]
          .filter((session) => saoPauloDate(new Date(session.started_at)) === todayIso);
        const total_seconds = sessions.reduce((sum, session) => session.ended_at
          ? sum + Math.max(0, Math.round((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000)) : sum, 0);
        setDay({ date: todayIso, attempt: memoryAttempt, error: false, day: { date: todayIso, sessions, session_count: sessions.length, total_seconds } });
      })
      .catch(() => { if (active) setDay({ date: todayIso, attempt: memoryAttempt, error: true, day: null }); });
    return () => { active = false; };
  }, [todayIso, memoryAttempt]);

  const memories = useMemo(
    () => (today?.sessions ?? [])
      .slice()
      .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [today],
  );

  const recentPages = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);

  const recall = useMemo(() => pickRecall(notes), [notes]);

  return (
    <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--theme-background)]">
      <div className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold text-[var(--theme-text)]">
            {greeting()}{user?.name?.trim() ? `, ${user.name.trim()}` : ''}
          </h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">Aqui está o resumo do seu dia no Brain Core.</p>
        </header>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-[2fr_1fr_1fr]">
          <div className="col-span-2 min-w-0 lg:col-span-1">
            <StatCard
              label="Continue daqui"
              value={recentPages[0]?.title ?? '—'}
              hint={pagesLoading ? 'Carregando páginas…' : pagesError ? 'Páginas indisponíveis' : recentPages[0] ? `Abrir página · editado ${relative(recentPages[0].updated_at)}` : 'sem atividade recente'}
              onClick={recentPages[0] ? () => onOpenPage(recentPages[0]) : undefined}
            />
          </div>
          <StatCard
            label="Gravações hoje"
            value={today ? String(today.session_count) : '—'}
            hint={memoriesLoading ? 'Carregando gravações…' : memoriesError ? 'Gravações indisponíveis' : today?.total_seconds ? `${formatDuration(today.total_seconds)} gravados` : 'nenhuma gravação concluída'}
          />
          <StatCard label="Notas" value={loading || error ? '—' : notes.length.toLocaleString('pt-BR')} hint={loading ? 'Carregando notas…' : error ? 'Notas indisponíveis' : 'no seu quadro'} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Memórias de hoje"
            action={
              <button
                type="button"
                onClick={() => navigate(`/remember?date=${todayIso}`)}
                className="text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              >
                Ver dia →
              </button>
            }
          >
            {memoriesLoading ? (
              <p role="status" className="text-sm text-[var(--theme-muted)]">Carregando memórias…</p>
            ) : memoriesError ? (
              <div role="alert" className="text-sm text-[var(--theme-text)]">
                <p>Não foi possível carregar as gravações de hoje.</p>
                <button type="button" aria-label="Tentar carregar gravações novamente" onClick={() => retryMemories(n => n + 1)}
                  className="mt-2 min-h-10 rounded px-2 text-[var(--theme-link)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)]">Tentar novamente</button>
              </div>
            ) : memories.length === 0 ? (
              <p className="text-sm text-[var(--theme-muted)]">Nenhuma gravação ainda.</p>
            ) : (
              <ol className="space-y-3">
                {memories.slice(0, 8).map((session) => (
                  <li key={session.id} className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 font-mono text-xs text-[var(--theme-muted)]">{hhmm(session.started_at)}</span>
                    <span
                      role="img"
                      aria-label={STATUS_LABEL[session.status] ?? session.status}
                      title={STATUS_LABEL[session.status] ?? session.status}
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${session.status === 'ready' ? 'bg-emerald-500' : session.status === 'error' ? 'bg-red-500' : 'bg-gray-500'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-2 text-sm text-[var(--theme-text)]">
                        {session.text?.trim() || (session.status === 'ready' ? 'Sem transcrição' : STATUS_LABEL[session.status])}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--theme-muted)]">{session.text?.trim() ? `${STATUS_LABEL[session.status]} · ` : ''}{sessionMeta(session)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Páginas recentes">
            {pagesLoading ? (
              <p role="status" className="text-sm text-[var(--theme-muted)]">Carregando páginas…</p>
            ) : pagesError ? (
              <div role="alert" className="text-sm text-[var(--theme-text)]">
                <p>Não foi possível carregar as páginas recentes.</p>
                <button type="button" aria-label="Tentar carregar páginas novamente" onClick={() => retryPages(n => n + 1)}
                  className="mt-2 min-h-10 rounded px-2 text-[var(--theme-link)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)]">Tentar novamente</button>
              </div>
            ) : recentPages.length === 0 ? (
              <p className="text-sm text-[var(--theme-muted)]">Nenhuma página editada recentemente.</p>
            ) : (
              <ul className="space-y-2">
                {recentPages.map((page) => (
                  <li key={page.id}>
                    <button
                      type="button"
                      onClick={() => onOpenPage(page)}
                      className="flex w-full items-center gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-background)] px-3 py-2.5 text-left hover:bg-[var(--theme-hover)]"
                    >
                      <span aria-hidden="true" className="text-base">{page.icon || '📄'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--theme-text)]">{page.title}</span>
                        <span className="block text-xs text-[var(--theme-muted)]">Editado {relative(page.updated_at)}</span>
                      </span>
                      <span aria-hidden="true" className="text-[var(--theme-muted)]">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {recall.length > 0 && (
          <section className="mt-6 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)]">
              <span aria-hidden="true">🧠</span> Lembrado pelo Brain
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {recall.map(({ label, note }) => (
                <div key={label} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-background)] p-4">
                  <p className="text-xs font-medium text-[var(--theme-muted)]">{label}</p>
                  <p className="mt-0.5 text-xs text-[var(--theme-muted)]">{note.created_at.slice(0, 10).split('-').reverse().join('/')}</p>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--theme-text)]">{note.title || note.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8" aria-label="Notas">
          <NotasBoard notes={notes} loading={loading} error={error} onCreate={createNote} onSave={saveNote} onDelete={deleteNote} />
        </section>
      </div>
    </div>
  );
}
