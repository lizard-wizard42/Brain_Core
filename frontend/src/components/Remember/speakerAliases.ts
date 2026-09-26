export type Speaker = string;
export type SpeakerAliases = Record<string, string>;

export const defaultSpeakerLabels: Record<string, string> = {
  me: 'Você',
  other: 'Participante',
  unknown: 'Não identificado',
};

const PALETTE = ['#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#fb923c', '#818cf8'];

export function defaultLabelForSpeaker(speaker?: string | null): string {
  if (!speaker || speaker === 'unknown') return defaultSpeakerLabels.unknown;
  if (speaker === 'me') return defaultSpeakerLabels.me;
  if (speaker === 'other') return defaultSpeakerLabels.other;
  const match = speaker.match(/^(?:speaker|pessoa)[_-]?(\d+)$/i);
  if (match) return `Pessoa ${Number(match[1]) + 1}`;
  return speaker.charAt(0).toUpperCase() + speaker.slice(1);
}

export function speakerTone(speaker?: string | null): { tone: string; isMe: boolean } {
  if (speaker === 'me') return { tone: 'var(--theme-primary)', isMe: true };
  if (!speaker || speaker === 'unknown') return { tone: 'var(--theme-muted, #9ca3af)', isMe: false };
  if (speaker === 'other') return { tone: '#a78bfa', isMe: false };
  const match = speaker.match(/^(?:speaker|pessoa)[_-]?(\d+)$/i);
  if (match) {
    const idx = Number(match[1]) % PALETTE.length;
    return { tone: PALETTE[idx], isMe: false };
  }
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) hash = (hash * 31 + speaker.charCodeAt(i)) >>> 0;
  return { tone: PALETTE[hash % PALETTE.length], isMe: false };
}

function key(sessionId: string): string { return `brain-core:speaker-aliases:${sessionId}`; }
function turnKey(sessionId: string): string { return `brain-core:turn-speakers:${sessionId}`; }
function stableTurnKey(sessionId: string): string { return `brain-core:turn-speakers-by-id:${sessionId}`; }

export function loadSpeakerAliases(sessionId: string): SpeakerAliases {
  try {
    const saved = JSON.parse(localStorage.getItem(key(sessionId)) || '{}') as SpeakerAliases;
    return Object.fromEntries(
      Object.entries(saved).filter(([speaker, label]) =>
        typeof speaker === 'string' && typeof label === 'string' && label.trim().length > 0 && label.length <= 40
      )
    );
  } catch { return {}; }
}

export function saveSpeakerAliases(sessionId: string, aliases: SpeakerAliases): void {
  try { localStorage.setItem(key(sessionId), JSON.stringify(aliases)); } catch { /* local presentation remains usable */ }
}

export function speakerLabel(sessionId: string, speaker?: string | null): string {
  const norm = speaker || 'unknown';
  return loadSpeakerAliases(sessionId)[norm] || defaultLabelForSpeaker(norm);
}

export function loadTurnSpeakerOverrides(sessionId: string): Record<number, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(turnKey(sessionId)) || '{}') as Record<string, string>;
    const result: Record<number, string> = {};
    for (const [k, v] of Object.entries(saved)) {
      const idx = Number(k);
      if (Number.isInteger(idx) && typeof v === 'string') result[idx] = v;
    }
    return result;
  } catch { return {}; }
}

export function saveTurnSpeakerOverride(sessionId: string, turnIndex: number, speaker: string): void {
  try {
    const overrides = loadTurnSpeakerOverrides(sessionId);
    overrides[turnIndex] = speaker;
    localStorage.setItem(turnKey(sessionId), JSON.stringify(overrides));
  } catch { /* local presentation remains usable */ }
}

export function loadStableTurnSpeakerOverrides(sessionId: string): Record<number, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(stableTurnKey(sessionId)) || '{}') as Record<string, string>;
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(saved)) {
      const id = Number(key);
      if (Number.isSafeInteger(id) && id > 0 && (value === 'me' || value === 'other')) result[id] = value;
    }
    return result;
  } catch { return {}; }
}

export function saveStableTurnSpeakerOverride(sessionId: string, turnId: number, speaker: string): void {
  if (!Number.isSafeInteger(turnId) || turnId <= 0 || (speaker !== 'me' && speaker !== 'other')) return;
  try {
    const overrides = loadStableTurnSpeakerOverrides(sessionId);
    overrides[turnId] = speaker;
    localStorage.setItem(stableTurnKey(sessionId), JSON.stringify(overrides));
  } catch { /* local presentation remains usable */ }
}
