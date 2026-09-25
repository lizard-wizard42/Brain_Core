import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalDrawer } from './TerminalDrawer';

const socketHandlers = new Map<string, Function>();
const emitSpy = vi.fn();
const onSpy = vi.fn((event: string, handler: Function) => {
  socketHandlers.set(event, handler);
});
const offSpy = vi.fn((event: string) => {
  socketHandlers.delete(event);
});

const mockSocket = {
  id: 'sock-1',
  connected: true,
  on: onSpy,
  off: offSpy,
  emit: emitSpy,
};

const fitSpy = vi.fn();

vi.mock('xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    textarea = { focus: vi.fn() };
    loadAddon = vi.fn();
    open = vi.fn();
    onData = vi.fn();
    clear = vi.fn();
    writeln = vi.fn();
    write = vi.fn((_data: string, cb?: () => void) => cb?.());
    reset = vi.fn();
    refresh = vi.fn();
    scrollToBottom = vi.fn();
    scrollLines = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = fitSpy;
  },
}));

vi.mock('../../hooks/useSocket', () => ({
  getAppSocket: () => mockSocket,
}));

vi.mock('../../api/client', () => ({
  api: {
    upsertTerminalTab: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./terminalSessionRegistry', () => ({
  getTerminalSessionSnapshot: vi.fn(() => null),
  saveTerminalSessionSnapshot: vi.fn(),
  clearTerminalSessionSnapshot: vi.fn(),
  clearTerminalSessionSnapshotBySessionId: vi.fn(),
}));

describe('TerminalDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers.clear();
    (globalThis as any).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('inicia sessão e emite terminal:create', async () => {
    render(
      <TerminalDrawer
        open
        request={{ key: 'k1', title: 'Terminal Teste', cwd: '/tmp' }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(emitSpy).toHaveBeenCalledWith(
        'terminal:create',
        expect.objectContaining({ cwd: '/tmp', workspaceKey: 'k1' }),
      );
    });

    expect(screen.getByText('connecting')).toBeInTheDocument();
  });

  it('processa terminal:ready e atualiza status/cwd', async () => {
    render(
      <TerminalDrawer
        open
        request={{ key: 'k2', title: 'Terminal Ready', cwd: '/workspace' }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(socketHandlers.has('terminal:ready')).toBe(true));

    const ready = socketHandlers.get('terminal:ready') as Function;
    ready({
      sessionId: 'sess-1',
      cwd: '/workspace/brain-core',
      workspaceKey: 'k2',
    });

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    expect(screen.getByText('/workspace/brain-core')).toBeInTheDocument();
  });

  it('fecha sessão ativa quando drawer é fechado', async () => {
    const { rerender } = render(
      <TerminalDrawer
        open
        request={{ key: 'k3', title: 'Terminal Close', cwd: '/tmp' }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(socketHandlers.has('terminal:ready')).toBe(true));
    const ready = socketHandlers.get('terminal:ready') as Function;
    ready({ sessionId: 'sess-close', cwd: '/tmp', workspaceKey: 'k3' });

    rerender(
      <TerminalDrawer
        open={false}
        request={{ key: 'k3', title: 'Terminal Close', cwd: '/tmp' }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(emitSpy).toHaveBeenCalledWith('terminal:close', { sessionId: 'sess-close' });
    });
  });
});
