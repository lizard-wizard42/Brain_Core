import { useMemo } from 'react';
import { localDate } from '../../services/localDate';

interface ActivityItem {
  date: string; // YYYY-MM-DD
  count: number;
}

interface ActivityHeatmapProps {
  activityData: ActivityItem[];
  onSelectDate?: (date: string) => void;
  selectedDate?: string;
  today?: string;
}

export function ActivityHeatmap({ activityData, onSelectDate, selectedDate, today = localDate() }: ActivityHeatmapProps) {
  const days = useMemo(() => {
    const list: { date: string; count: number }[] = [];
    const map = new Map<string, number>();
    for (const item of activityData) {
      map.set(item.date, (map.get(item.date) || 0) + item.count);
    }

    const [year, month, day] = today.split('-').map(Number);
    const end = new Date(year, month - 1, day);
    for (let i = 89; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const iso = localDate(d);
      list.push({
        date: iso,
        count: map.get(iso) || 0,
      });
    }
    return list;
  }, [activityData, today]);

  const leadingEmptyDays = useMemo(() => {
    const [year, month, day] = days[0].date.split('-').map(Number);
    return new Date(year, month - 1, day).getDay();
  }, [days]);
  const columns = Math.ceil((leadingEmptyDays + days.length) / 7);

  const totalActions = useMemo(() => {
    return days.reduce((sum, d) => sum + d.count, 0);
  }, [days]);
  const activeDays = days.filter(day => day.count > 0).length;
  const peak = days.reduce((best, day) => day.count > best.count ? day : best, days[0]);

  const getColorClass = (count: number) => {
    if (count === 0) return 'bg-[#262626] border-[#333]';
    if (count <= 2) return 'bg-[#1e3a5f] border-[#254b7c]';
    if (count <= 5) return 'bg-[#2563eb] border-[#3b82f6]';
    if (count <= 10) return 'bg-[#3b82f6] border-[#60a5fa]';
    return 'bg-[#60a5fa] border-[#93c5fd]';
  };

  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">📊</span>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">
            Consistência & Atividade (Últimos 90 dias)
          </h2>
        </div>
        <span className="text-xs text-[var(--theme-muted)]">
          <strong className="text-[var(--theme-text)] font-semibold">{totalActions}</strong> páginas e notas
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[max-content_minmax(0,1fr)] lg:items-center lg:gap-8">
        <div className="overflow-x-auto pb-1">
          <div className="w-max">
            <div className="grid grid-flow-col grid-rows-7 gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, 18px)` }}>
              {Array.from({ length: leadingEmptyDays }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
              {days.map(d => {
                const isSelected = selectedDate === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => onSelectDate?.(d.date)}
                    title={`${d.date}: ${d.count} atividade(s)`}
                    aria-label={`${d.date}: ${d.count} atividade(s)`}
                    className={`h-[18px] w-[18px] rounded-[4px] border transition-all ${getColorClass(
                      d.count
                    )} ${
                      isSelected ? 'ring-2 ring-[#89aef1] ring-offset-1 ring-offset-[#191919]' : ''
                    } hover:scale-110 focus-visible:outline-none`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-[var(--theme-muted)]">
              <span>Menos</span>
              <div className="h-2.5 w-2.5 rounded-sm bg-[#262626] border border-[#333]" />
              <div className="h-2.5 w-2.5 rounded-sm bg-[#1e3a5f] border border-[#254b7c]" />
              <div className="h-2.5 w-2.5 rounded-sm bg-[#2563eb] border border-[#3b82f6]" />
              <div className="h-2.5 w-2.5 rounded-sm bg-[#3b82f6] border border-[#60a5fa]" />
              <div className="h-2.5 w-2.5 rounded-sm bg-[#60a5fa] border border-[#93c5fd]" />
              <span>Mais</span>
            </div>
          </div>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-background)] p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--theme-muted)]">Dias com páginas ou notas</p>
            <div className="mt-2 flex items-baseline gap-2">
              <strong className="text-2xl font-semibold text-[var(--theme-text)]">{activeDays}</strong>
              <span className="text-xs text-[var(--theme-muted)]">de 90 dias</span>
            </div>
            <div role="progressbar" aria-label="Dias com páginas ou notas" aria-valuemin={0} aria-valuemax={90} aria-valuenow={activeDays} className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--theme-hover)]">
              <div className="h-full rounded-full bg-[var(--theme-primary)]" style={{ width: `${activeDays / 90 * 100}%` }} />
            </div>
          </div>
          <div className="min-w-0 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-background)] p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--theme-muted)]">Maior volume no dia</p>
            <strong className="mt-2 block text-2xl font-semibold text-[var(--theme-text)]">{peak.count}</strong>
            <p className="mt-1 text-xs text-[var(--theme-muted)]">{peak.count > 0 ? `Páginas ou notas em ${peak.date.split('-').reverse().join('/')}` : 'Nenhum registro neste período.'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
