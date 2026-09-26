import type { RememberSession } from '../../types';
import { speakerLabel } from './speakerAliases';


function fmtRange(session: RememberSession): string {
  const start = new Date(session.started_at);
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const day = start.toLocaleDateString('pt-BR', { dateStyle: 'long' });
  const from = start.toLocaleTimeString('pt-BR', opts);
  const to = session.ended_at ? new Date(session.ended_at).toLocaleTimeString('pt-BR', opts) : '—';
  return `${day}, ${from}–${to}`;
}

/** Markdown dump of one session — meant to be pasted into an AI chat. */
export function sessionToMarkdown(session: RememberSession): string {
  const lines: string[] = [
    `# Memória — ${fmtRange(session)}`,
    '',
    '> Transcrição automática de áudio — pode conter erros.',
    '> Os falantes são inferidos por comparação de voz e podem estar trocados.',
    '',
  ];

  const turns = (session.turns ?? []).filter((turn) => turn.text.trim());
  const hasSpeakers = turns.some((turn) => turn.speaker);

  if (hasSpeakers) {
    for (const turn of turns) {
      const speaker = turn.speaker === 'me' || turn.speaker === 'other' ? turn.speaker : 'unknown';
      lines.push(`**${speakerLabel(session.id, speaker)}:** ${turn.text.trim()}`);
    }
  } else if (turns.length) {
    for (const turn of turns) lines.push(turn.text.trim());
  } else if (session.text) {
    lines.push(session.text.trim());
  } else {
    lines.push('_(sem transcrição)_');
  }

  if (hasSpeakers && session.text) {
    lines.push('', '---', '', '## Texto corrido (sem separação de falantes)', '', session.text.trim());
  }

  return lines.join('\n') + '\n';
}

export async function copySessionMarkdown(session: RememberSession): Promise<boolean> {
  const md = sessionToMarkdown(session);
  try {
    await navigator.clipboard.writeText(md);
    return true;
  } catch {
    return false;
  }
}

export function downloadSessionMarkdown(session: RememberSession): void {
  const md = sessionToMarkdown(session);
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `memoria-${session.id}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
