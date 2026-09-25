import type { RememberDay, RememberSession, RememberSpeaker, RememberSpeakerCluster, RememberTurn } from '../../types';

const LEGACY_LABEL: Record<RememberSpeaker, string> = {
  me: 'Você', other: 'Outra pessoa', unknown: 'Não identificado',
};

/** cluster 0 é sempre "eu" e nunca cai aqui; 1→A, 2→B, … */
export function clusterLetter(cluster: number): string {
  return String.fromCharCode(64 + Math.max(1, cluster));
}

function findCluster(session: RememberSession, cluster: number): RememberSpeakerCluster | undefined {
  return session.speakers?.find((s) => s.cluster === cluster);
}

export function clusterLabel(
  session: RememberSession,
  cluster: number | null | undefined,
  speaker?: RememberSpeaker | null,
): string {
  if (cluster == null) return speaker ? LEGACY_LABEL[speaker] : '—';
  const sc = findCluster(session, cluster);
  if (sc?.is_me) return 'Você';
  if (sc?.status === 'confirmed' && sc.name) return sc.name;
  return `Falante ${clusterLetter(cluster)}`;
}

const TINTS = ['text-sky-300', 'text-emerald-300', 'text-amber-300', 'text-violet-300', 'text-rose-300'];

export function personTint(personId: number | null): string {
  if (personId == null) return 'text-gray-400';
  return TINTS[Math.abs(personId) % TINTS.length];
}

/** "Esta fala é minha?" — pela identidade do cluster, não pelo `speaker` do
 *  diarizer (que deriva ao re-cadastrar a voz). Cluster 0 é sempre eu; se o
 *  turno não tem cluster, cai no `speaker` legado. */
export function isMyTurn(session: RememberSession, turn: RememberTurn): boolean {
  if (turn.cluster == null) return turn.speaker === 'me';
  if (turn.cluster === 0) return true;
  return findCluster(session, turn.cluster)?.is_me === true;
}

export function pendingCount(day: RememberDay | null | undefined): number {
  if (!day) return 0;
  let n = 0;
  for (const session of day.sessions) {
    for (const sc of session.speakers ?? []) {
      if (sc.status === 'pending' && !sc.is_me) n += 1;
    }
  }
  return n;
}
