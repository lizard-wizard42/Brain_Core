import { useCallback, useEffect, useState } from 'react';
import { rememberService } from '../../services/rememberService';
import { browserRecording } from '../../services/browserRecording';
import { onRememberStatus } from './rememberEvents';

const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function RememberSidebarTree({ onOpen }: { onOpen: (date?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [years, setYears] = useState<number[] | null>(null);
  const [months, setMonths] = useState<Record<number, number[]>>({});
  const [days, setDays] = useState<Record<string, string[]>>({});
  const [recording, setRecording] = useState(browserRecording.getState().phase === 'recording');
  const [error, setError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  useEffect(() => browserRecording.subscribe((next) => setRecording(next.phase === 'recording')), []);

  // Gap 2: re-fetch whatever the user has expanded so newly recorded days appear without a reload.
  const revalidate = useCallback(async () => {
    if (!expanded || years === null) return;
    try {
      setYears(await rememberService.getYears());
      await Promise.all(Object.keys(months).map(async (yearKey) => {
        const year = Number(yearKey);
        const loaded = await rememberService.getMonths(year);
        setMonths((value) => (value[year] ? { ...value, [year]: loaded } : value));
      }));
      await Promise.all(Object.keys(days).map(async (key) => {
        const [year, month] = key.split('-').map(Number);
        const loaded = await rememberService.getDays(year, month);
        setDays((value) => (value[key] ? { ...value, [key]: loaded } : value));
      }));
      setError(null);
    } catch {
      /* keep the tree we already have on a transient failure */
    }
  }, [expanded, years, months, days]);

  useEffect(() => onRememberStatus(() => {
    void revalidate();
  }), [revalidate]);

  const toggleRoot = async () => {
    const next = !expanded; setExpanded(next); onOpen();
    if (next && years === null) {
      try { setLoadingKey('years'); setYears(await rememberService.getYears()); setError(null); }
      catch { setError('Não foi possível carregar os anos'); }
      finally { setLoadingKey(null); }
    }
  };

  const toggleYear = async (year: number) => {
    if (months[year]) { setMonths((value) => { const next = { ...value }; delete next[year]; return next; }); return; }
    try { setLoadingKey(`year-${year}`); setMonths((value) => ({ ...value, [year]: [] })); const loaded = await rememberService.getMonths(year); setMonths((value) => ({ ...value, [year]: loaded })); }
    catch { setError('Não foi possível carregar os meses'); }
    finally { setLoadingKey(null); }
  };

  const toggleMonth = async (year: number, month: number) => {
    const key = `${year}-${month}`;
    if (days[key]) { setDays((value) => { const next = { ...value }; delete next[key]; return next; }); return; }
    try { setLoadingKey(`month-${key}`); setDays((value) => ({ ...value, [key]: [] })); const loaded = await rememberService.getDays(year, month); setDays((value) => ({ ...value, [key]: loaded })); }
    catch { setError('Não foi possível carregar os dias'); }
    finally { setLoadingKey(null); }
  };

  const today = new Date().toISOString().slice(0, 10);
  return <div className="mb-2">
    <button type="button" aria-expanded={expanded} onClick={() => void toggleRoot()} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-200 hover:bg-white/[0.04]">
      <span aria-hidden="true" className="w-3 text-gray-500">{expanded ? '▾' : '▸'}</span><span>🧠</span><span className="flex-1 font-medium">Linha do tempo</span><span className={recording ? 'text-red-400' : 'text-gray-600'} aria-label={recording ? 'PC gravando' : 'PC sem gravação'}>●</span>
    </button>
    {expanded && <div className="ml-5 border-l border-white/5 pl-1">
      {years === null && !error && <p className="px-2 py-1 text-[11px] text-gray-600">Carregando…</p>}
      {error && <p role="alert" className="px-2 py-1 text-[11px] text-red-400">{error}</p>}
      {years?.length === 0 && !error && <p className="px-2 py-2 text-[11px] leading-4 text-gray-500">Nenhuma memória sincronizada ainda.</p>}
      {years?.map((year) => <div key={year}><button type="button" aria-expanded={Boolean(months[year])} onClick={() => void toggleYear(year)} className="w-full rounded px-2 py-1 text-left text-xs text-gray-400 hover:bg-white/[0.03]">{months[year] ? '▾' : '▸'} {year}</button>
        {loadingKey === `year-${year}` && <p className="ml-5 px-2 py-1 text-[11px] text-gray-600">Carregando meses…</p>}
        {months[year]?.map((month) => { const key = `${year}-${month}`; return <div key={month} className="ml-3"><button type="button" aria-expanded={Boolean(days[key])} onClick={() => void toggleMonth(year, month)} className="w-full rounded px-2 py-1 text-left text-xs text-gray-400 hover:bg-white/[0.03]">{days[key] ? '▾' : '▸'} {monthNames[month - 1]}</button>
          {loadingKey === `month-${key}` && <p className="ml-5 px-2 py-1 text-[11px] text-gray-600">Carregando dias…</p>}
          {days[key]?.map((date) => <button type="button" key={date} onClick={() => onOpen(date)} className="ml-5 block rounded px-2 py-1 text-xs text-gray-500 hover:bg-white/[0.03] hover:text-gray-300">{Number(date.slice(8))}{date === today ? ' — Hoje' : ''}</button>)}</div>; })}
      </div>)}
    </div>}
  </div>;
}
