import type { NotebookTool } from './NotebookCanvas';

export function NotebookToolIcon({ tool }: { tool: NotebookTool | 'undo' | 'redo' | 'paper' | 'download' }) {
  const paths: Record<typeof tool, string> = {
    pen: 'M4 20l1-5L16 4a2.2 2.2 0 013 3L8 18l-4 2zM14 6l4 4M5 15l3 3',
    highlighter: 'M4 20h8M6 16l3-5 5 5-5 2-3-2zM9 11l6-7 5 5-6 7',
    eraser: 'M4 14l8-9a2 2 0 013 0l5 5a2 2 0 010 3l-7 7H9l-5-4a1.5 1.5 0 010-2zM9 9l8 8M13 20h8',
    select: 'M7 4H4v3M17 4h3v3M4 17v3h3M20 17v3h-3M4 10v4M20 10v4M10 4h4M10 20h4',
    text: 'M5 5h14M12 5v15M8 20h8',
    hand: 'M8 12V6a1.5 1.5 0 013 0v5-7a1.5 1.5 0 013 0v7-5a1.5 1.5 0 013 0v6-3a1.5 1.5 0 013 0v7c0 4-3 6-7 6-3 0-5-2-7-5l-2-3a1.5 1.5 0 012-2l2 2',
    undo: 'M8 5L3 10l5 5M3 10h10a6 6 0 016 6v3',
    redo: 'M16 5l5 5-5 5M21 10H11a6 6 0 00-6 6v3',
    paper: 'M6 3h9l4 4v14H6V3zM15 3v5h4M9 12h7M9 16h7',
    download: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[tool]} /></svg>;
}
