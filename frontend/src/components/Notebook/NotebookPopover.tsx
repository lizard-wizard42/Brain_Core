import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Small popover opened by a 44 px button; closes with Escape (focus returns to the button) or a press outside. */
export function NotebookPopover({ label, trigger, direction = 'down', className = '', children }: {
  label: string; trigger: ReactNode; direction?: 'down' | 'up'; className?: string; children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); setOpen(false); button.current?.focus();
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div ref={root} className={`notebook-popover ${className}`.trim()}>
    <button ref={button} type="button" className="notebook-button" aria-label={label} title={label} aria-haspopup="true" aria-expanded={open}
      onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open && <div className={`notebook-popover-panel notebook-popover-${direction}`} role="group" aria-label={label}>{children(() => setOpen(false))}</div>}
  </div>;
}
