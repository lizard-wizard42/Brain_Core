import type { RememberSession } from '../../types';
import { spDateLong, spTime } from './rememberTime';

const SPEAKER_MD: Record<string, string> = {
  me: 'Você',
  other: 'Outra pessoa',
  unknown: 'Não identificado',
};

function fmtRange(session: RememberSession): string {
  const day = spDateLong(session.started_at);
  const from = spTime(session.started_at);
  const to = session.ended_at ? spTime(session.ended_at) : '—';
  return `${day}, ${from}–${to}`;
}

/** Markdown dump of one session — meant to be pasted into an AI chat. */
export function sessionToMarkdown(session: RememberSession): string {
  const lines: string[] = [
    `# Memória — ${fmtRange(session)}`,
    '',
    '> Transcrição automática (Whisper) de um áudio de celular — pode conter erros.',
    '> Os falantes são inferidos por comparação de voz e podem estar trocados.',
    '',
  ];

  const turns = (session.turns ?? []).filter((turn) => turn.text.trim());
  const hasSpeakers = turns.some((turn) => turn.speaker);

  if (hasSpeakers) {
    for (const turn of turns) {
      lines.push(`**${turn.speaker ? SPEAKER_MD[turn.speaker] ?? turn.speaker : '—'}:** ${turn.text.trim()}`);
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
