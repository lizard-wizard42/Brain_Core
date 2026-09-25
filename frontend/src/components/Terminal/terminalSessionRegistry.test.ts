import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTerminalSessionSnapshot,
  clearTerminalSessionSnapshotBySessionId,
  closeAllTrackedTerminalSessions,
  closeTerminalSessionForRequestKey,
  getTerminalSessionSnapshot,
  saveTerminalSessionSnapshot,
} from './terminalSessionRegistry';

const emitSpy = vi.fn();
const closeTerminalTabSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useSocket', () => ({
  getAppSocket: () => ({ emit: emitSpy }),
}));

vi.mock('../../api/client', () => ({
  api: {
    closeTerminalTab: (...args: unknown[]) => closeTerminalTabSpy(...args),
  },
}));

describe('terminalSessionRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllTrackedTerminalSessions();
  });

  it('salva e recupera snapshot por requestKey', () => {
    saveTerminalSessionSnapshot('req-1', { sessionId: 's1', cwd: '/tmp' });

    expect(getTerminalSessionSnapshot('req-1')).toEqual({ sessionId: 's1', cwd: '/tmp' });
  });

  it('limpa snapshot por requestKey e por sessionId', () => {
    saveTerminalSessionSnapshot('req-2', { sessionId: 's2', cwd: '/a' });

    clearTerminalSessionSnapshot('req-2');
    expect(getTerminalSessionSnapshot('req-2')).toBeNull();

    saveTerminalSessionSnapshot('req-3', { sessionId: 's3', cwd: '/b' });
    clearTerminalSessionSnapshotBySessionId('s3');
    expect(getTerminalSessionSnapshot('req-3')).toBeNull();
  });

  it('fecha sessão por requestKey emitindo close e limpando mapa', () => {
    saveTerminalSessionSnapshot('req-4', { sessionId: 's4', cwd: '/x' });

    closeTerminalSessionForRequestKey('req-4');

    expect(emitSpy).toHaveBeenCalledWith('terminal:close', { sessionId: 's4' });
    expect(closeTerminalTabSpy).toHaveBeenCalledWith('req-4');
    expect(getTerminalSessionSnapshot('req-4')).toBeNull();
  });

  it('fecha todas as sessões rastreadas', () => {
    saveTerminalSessionSnapshot('req-a', { sessionId: 'sa', cwd: '/a' });
    saveTerminalSessionSnapshot('req-b', { sessionId: 'sb', cwd: '/b' });

    closeAllTrackedTerminalSessions();

    expect(emitSpy).toHaveBeenCalledWith('terminal:close', { sessionId: 'sa' });
    expect(emitSpy).toHaveBeenCalledWith('terminal:close', { sessionId: 'sb' });
    expect(getTerminalSessionSnapshot('req-a')).toBeNull();
    expect(getTerminalSessionSnapshot('req-b')).toBeNull();
  });
});
