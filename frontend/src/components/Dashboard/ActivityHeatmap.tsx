import { useMemo } from 'react';

interface ActivityItem {
  date: string; // YYYY-MM-DD
  count: number;
}

interface ActivityHeatmapProps {
  activityData: ActivityItem[];
  onSelectDate?: (date: string) => void;
  selectedDate?: string;
}

export function ActivityHeatmap({ activityData, onSelectDate, selectedDate }: ActivityHeatmapProps) {
  // Generate the last 90 days (approx ~13 weeks)
  const days = useMemo(() => {
    const list: { date: string; dayOfWeek: number; count: number }[] = [];
    const map = new Map<string, number>();
    for (const item of activityData) {
      map.set(item.date, (map.get(item.date) || 0) + item.count);
    }

    const today = new Date();
    // 91 days = 13 weeks exactly
    for (let i = 90; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      list.push({
        date: iso,
        dayOfWeek: d.getDay(),
        count: map.get(iso) || 0,
      });
    }
    return list;
  }, [activityData]);

  const totalActions = useMemo(() => {
    return days.reduce((sum, d) => sum + d.count, 0);
  }, [days]);

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
          <strong className="text-[var(--theme-text)] font-semibold">{totalActions}</strong> contribuições
        </span>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="inline-grid grid-flow-col grid-rows-7 gap-1.5 min-w-[580px]">
          {days.map(d => {
            const isSelected = selectedDate === d.date;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelectDate?.(d.date)}
                title={`${d.date}: ${d.count} atividade(s)`}
                aria-label={`${d.date}: ${d.count} atividade(s)`}
                className={`h-3 w-3 sm:h-3.5 sm:w-3.5 rounded-sm border transition-all ${getColorClass(
                  d.count
                )} ${
                  isSelected ? 'ring-2 ring-[#89aef1] ring-offset-1 ring-offset-[#191919]' : ''
                } hover:scale-125 focus-visible:outline-none`}
              />
            );
          })}
        </div>
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
  );
}
