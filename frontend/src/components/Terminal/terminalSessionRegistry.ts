import { getAppSocket } from '../../hooks/useSocket';
import { api } from '../../api/client';

export interface TerminalSessionSnapshot {
  sessionId: string;
  cwd: string | null;
}

const sessionsByRequestKey = new Map<string, TerminalSessionSnapshot>();
const requestKeyBySessionId = new Map<string, string>();

export function getTerminalSessionSnapshot(requestKey: string): TerminalSessionSnapshot | null {
  return sessionsByRequestKey.get(requestKey) ?? null;
}

export function saveTerminalSessionSnapshot(requestKey: string, snapshot: TerminalSessionSnapshot): void {
  const previous = sessionsByRequestKey.get(requestKey);
  if (previous?.sessionId && previous.sessionId !== snapshot.sessionId) {
    requestKeyBySessionId.delete(previous.sessionId);
  }

  sessionsByRequestKey.set(requestKey, snapshot);
  requestKeyBySessionId.set(snapshot.sessionId, requestKey);
}

export function clearTerminalSessionSnapshot(requestKey: string): void {
  const snapshot = sessionsByRequestKey.get(requestKey);
  if (snapshot?.sessionId) {
    requestKeyBySessionId.delete(snapshot.sessionId);
  }
  sessionsByRequestKey.delete(requestKey);
}

export function clearTerminalSessionSnapshotBySessionId(sessionId: string): void {
  const requestKey = requestKeyBySessionId.get(sessionId);
  if (!requestKey) return;
  requestKeyBySessionId.delete(sessionId);
  sessionsByRequestKey.delete(requestKey);
}

export function closeTerminalSessionForRequestKey(requestKey: string): void {
  const snapshot = sessionsByRequestKey.get(requestKey);
  if (snapshot) {
    getAppSocket().emit('terminal:close', { sessionId: snapshot.sessionId });
  }
  void api.closeTerminalTab(requestKey).catch(() => {});
  clearTerminalSessionSnapshot(requestKey);
}

export function closeAllTrackedTerminalSessions(): void {
  const requestKeys = Array.from(sessionsByRequestKey.keys());
  if (!requestKeys.length) return;

  requestKeys.forEach((requestKey) => {
    closeTerminalSessionForRequestKey(requestKey);
  });

  sessionsByRequestKey.clear();
  requestKeyBySessionId.clear();
}
