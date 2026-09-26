import type { PageShareRole } from '../../types';
import { roleLabel } from './sharedModel';

export function ShareBadge({
  role,
  count,
  onClick,
  title,
}: {
  role: PageShareRole;
  count?: number;
  onClick?: () => void;
  title?: string;
}) {
  const label = roleLabel(role);
  const text = typeof count === 'number' && count > 1 ? `${label} · ${count}` : label;
  const className = 'inline-flex items-center gap-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--theme-muted)]';
  if (!onClick) {
    return (
      <span className={className} title={title ?? label} aria-label={`Compartilhada: ${label}`}>
        <span aria-hidden="true">👥</span>
        <span>{text}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} hover:text-[var(--theme-text)] hover:border-[var(--theme-accent)]`}
      title={title ?? 'Gerenciar acesso'}
      aria-label={`Compartilhada: ${label}. Gerenciar acesso`}
    >
      <span aria-hidden="true">👥</span>
      <span>{text}</span>
    </button>
  );
}
