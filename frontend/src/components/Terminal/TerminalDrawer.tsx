import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { getAppSocket } from '../../hooks/useSocket';
import { api } from '../../api/client';
import {
  clearTerminalSessionSnapshot,
  clearTerminalSessionSnapshotBySessionId,
  getTerminalSessionSnapshot,
  saveTerminalSessionSnapshot,
} from './terminalSessionRegistry';

export interface TerminalRequest {
  key: string;
  title: string;
  cwd?: string | null;
}

interface TerminalDrawerProps {
  open: boolean;
  request: TerminalRequest | null;
  onClose: () => void;
  variant?: 'drawer' | 'page';
}

type DrawerStatus = 'idle' | 'connecting' | 'ready' | 'error';

type MobileTerminalKey = {
  id: string;
  label: string;
  data: string;
  shiftData?: string;
  kind?: 'char' | 'sequence' | 'action';
};

const MOBILE_TERMINAL_ROWS: MobileTerminalKey[][] = [
  [
    { id: 'keyboard', label: 'KBD', data: '', kind: 'action' },
    { id: 'top-nav', label: 'TOP', data: '', kind: 'action' },
    { id: 'pgup-nav', label: 'PGUP', data: '', kind: 'action' },
    { id: 'pgdn-nav', label: 'PGDN', data: '', kind: 'action' },
    { id: 'bottom-nav', label: 'BOT', data: '', kind: 'action' },
    { id: 'esc', label: 'ESC', data: '\x1b', kind: 'sequence' },
    { id: 'tab', label: 'TAB', data: '\t', kind: 'sequence' },
    { id: 'ctrl', label: 'CTRL', data: '', kind: 'action' },
    { id: 'alt', label: 'ALT', data: '', kind: 'action' },
    { id: 'shift', label: 'SHIFT', data: '', kind: 'action' },
    { id: 'up', label: '↑', data: '\x1b[A', kind: 'sequence' },
    { id: 'down', label: '↓', data: '\x1b[B', kind: 'sequence' },
    { id: 'left', label: '←', data: '\x1b[D', kind: 'sequence' },
    { id: 'right', label: '→', data: '\x1b[C', kind: 'sequence' },
    { id: 'home', label: 'HOME', data: '\x1b[H', kind: 'sequence' },
    { id: 'end', label: 'END', data: '\x1b[F', kind: 'sequence' },
    { id: 'pgup', label: 'PGUP', data: '\x1b[5~', kind: 'sequence' },
    { id: 'pgdn', label: 'PGDN', data: '\x1b[6~', kind: 'sequence' },
  ],
  [
    { id: 'ctrl-c', label: '^C', data: '\x03', kind: 'sequence' },
    { id: 'ctrl-d', label: '^D', data: '\x04', kind: 'sequence' },
    { id: 'ctrl-l', label: '^L', data: '\x0c', kind: 'sequence' },
    { id: 'ctrl-z', label: '^Z', data: '\x1a', kind: 'sequence' },
    { id: 'slash', label: '/', data: '/', shiftData: '?', kind: 'char' },
    { id: 'backslash', label: '\\', data: '\\', shiftData: '|', kind: 'char' },
    { id: 'dash', label: '-', data: '-', shiftData: '_', kind: 'char' },
    { id: 'equal', label: '=', data: '=', shiftData: '+', kind: 'char' },
    { id: 'lbracket', label: '[', data: '[', shiftData: '{', kind: 'char' },
    { id: 'rbracket', label: ']', data: ']', shiftData: '}', kind: 'char' },
    { id: 'lparen', label: '(', data: '(', shiftData: '(', kind: 'char' },
    { id: 'rparen', label: ')', data: ')', shiftData: ')', kind: 'char' },
    { id: 'quote', label: '\'', data: '\'', shiftData: '"', kind: 'char' },
    { id: 'backtick', label: '`', data: '`', shiftData: '~', kind: 'char' },
    { id: 'colon', label: ';', data: ';', shiftData: ':', kind: 'char' },
    { id: 'dollar', label: '$', data: '$', shiftData: '$', kind: 'char' },
    { id: 'enter', label: 'ENTER', data: '\r', kind: 'sequence' },
    { id: 'bksp', label: 'BKSP', data: '\x7f', kind: 'sequence' },
  ],
];

export function TerminalDrawer({ open, request, onClose, variant = 'drawer' }: TerminalDrawerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const socketRef = useRef(getAppSocket());
  const sessionIdRef = useRef<string | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const openRef = useRef(open);
  const requestRef = useRef(request);
  const activeRequestKeyRef = useRef<string | null>(null);
  const pendingRequestKeyRef = useRef<string | null>(null);

  const [status, setStatus] = useState<DrawerStatus>('idle');
  const [expanded, setExpanded] = useState(false);
  const [cwd, setCwd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ctrlLocked, setCtrlLocked] = useState(false);
  const [altLocked, setAltLocked] = useState(false);
  const [shiftLocked, setShiftLocked] = useState(false);
  const isPage = variant === 'page';
  const repaintScheduledRef = useRef(false);
  const activationNudgeRef = useRef<number[]>([]);
  const mountedRef = useRef(false);

  const repaintTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    fitAddonRef.current?.fit();
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
    terminal.scrollToBottom();
  }, []);

  const nudgeTerminalViewport = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const step = Math.max(1, Math.min(terminal.rows, 8));
    terminal.scrollLines(-step);
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
    terminal.scrollToBottom();
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  }, []);

  const replayTerminalViewport = useCallback(() => {
    if (!mountedRef.current) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    socketRef.current.emit('terminal:navigate', { sessionId, action: 'page_up' });
    const bottomId = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        const currentSessionId = sessionIdRef.current;
        if (!currentSessionId || currentSessionId !== sessionId) return;
        socketRef.current.emit('terminal:navigate', { sessionId, action: 'bottom' });
      });
    }, 8);
    activationNudgeRef.current.push(bottomId);
  }, []);

  const clearActivationNudges = useCallback(() => {
    activationNudgeRef.current.forEach((id) => window.clearTimeout(id));
    activationNudgeRef.current = [];
  }, []);

  const runActivationNudges = useCallback(() => {
    if (!mountedRef.current) return;
    clearActivationNudges();
    [0, 40, 120, 240].forEach((delay) => {
      const id = window.setTimeout(() => {
        nudgeTerminalViewport();
      }, delay);
      activationNudgeRef.current.push(id);
    });
  }, [clearActivationNudges, nudgeTerminalViewport]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearActivationNudges();
    };
  }, [clearActivationNudges]);

  const scheduleRepaint = useCallback((delay = 0) => {
    if (repaintScheduledRef.current) return;
    repaintScheduledRef.current = true;

    window.setTimeout(() => {
      repaintScheduledRef.current = false;
      window.requestAnimationFrame(() => {
        repaintTerminal();
      });
    }, delay);
  }, [repaintTerminal]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => () => {
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    sessionIdRef.current = null;
    activeRequestKeyRef.current = null;
    pendingRequestKeyRef.current = null;
  }, []);

  const sendTerminalInput = useCallback((data: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !data) return;
    socketRef.current.emit('terminal:input', { sessionId, data });
    terminalRef.current?.focus();
    terminalRef.current?.textarea?.focus();
  }, []);

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
    terminalRef.current?.textarea?.focus();
  }, []);

  const navigateTerminal = useCallback((action: 'page_up' | 'page_down' | 'top' | 'bottom') => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    socketRef.current.emit('terminal:navigate', { sessionId, action });
    focusTerminal();
  }, [focusTerminal]);

  const consumeModifiers = useCallback(() => {
    setCtrlLocked(false);
    setAltLocked(false);
    setShiftLocked(false);
  }, []);

  function applyCharModifiers(key: MobileTerminalKey): string {
    let value = shiftLocked && key.shiftData ? key.shiftData : key.data;

    if (ctrlLocked) {
      if (value.length === 1) {
        const char = value.toUpperCase();
        const code = char.charCodeAt(0);
        if (code >= 64 && code <= 95) {
          value = String.fromCharCode(code - 64);
        } else if (char === '?') {
          value = '\x7f';
        }
      }
    }

    if (altLocked) value = `\x1b${value}`;
    return value;
  }

  function applySequenceModifiers(key: MobileTerminalKey): string {
    const base = key.data;

    const csiMap: Record<string, string> = {
      '\x1b[A': 'A',
      '\x1b[B': 'B',
      '\x1b[C': 'C',
      '\x1b[D': 'D',
      '\x1b[H': 'H',
      '\x1b[F': 'F',
    };

    if (ctrlLocked || altLocked || shiftLocked) {
      if (base in csiMap) {
        let modifier = 1;
        if (shiftLocked) modifier += 1;
        if (altLocked) modifier += 2;
        if (ctrlLocked) modifier += 4;
        return `\x1b[1;${modifier}${csiMap[base]}`;
      }

      if (base === '\t' && shiftLocked) {
        return '\x1b[Z';
      }
    }

    if (altLocked && base.length === 1) {
      return `\x1b${base}`;
    }

    return base;
  }

  function handleMobileKey(key: MobileTerminalKey) {
    if (key.kind === 'action') {
      if (key.id === 'keyboard') {
        focusTerminal();
        return;
      }
      if (key.id === 'ctrl') {
        setCtrlLocked((value) => !value);
        focusTerminal();
        return;
      }
      if (key.id === 'alt') {
        setAltLocked((value) => !value);
        focusTerminal();
        return;
      }
      if (key.id === 'shift') {
        setShiftLocked((value) => !value);
        focusTerminal();
        return;
      }
      if (key.id === 'top-nav') {
        navigateTerminal('top');
        return;
      }
      if (key.id === 'pgup-nav') {
        navigateTerminal('page_up');
        return;
      }
      if (key.id === 'pgdn-nav') {
        navigateTerminal('page_down');
        return;
      }
      if (key.id === 'bottom-nav') {
        navigateTerminal('bottom');
        return;
      }
    }

    const payload = key.kind === 'char' ? applyCharModifiers(key) : applySequenceModifiers(key);
    sendTerminalInput(payload);
    consumeModifiers();
  }

  const startTerminalSession = useCallback((nextRequest: TerminalRequest) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const requestKey = nextRequest.key;
    if (!requestKey) return;

    if (activeRequestKeyRef.current === requestKey && (status === 'connecting' || status === 'ready')) {
      return;
    }

    const socket = socketRef.current;
    const fitAddon = fitAddonRef.current;
    const previousRequestKey = activeRequestKeyRef.current;
    const previousSessionId = sessionIdRef.current;
    if (previousRequestKey && previousRequestKey !== requestKey && previousSessionId) {
      saveTerminalSessionSnapshot(previousRequestKey, {
        sessionId: previousSessionId,
        cwd,
      });
    }

    sessionIdRef.current = null;
    activeRequestKeyRef.current = requestKey;
    pendingRequestKeyRef.current = requestKey;
    setStatus('connecting');
    setError(null);
    setCwd(getTerminalSessionSnapshot(requestKey)?.cwd ?? null);
    terminal.clear();
    terminal.writeln(`Connecting terminal for ${nextRequest.title}...`);
    fitAddon?.fit();

    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
    }
    connectTimeoutRef.current = window.setTimeout(() => {
      if (sessionIdRef.current) return;
      activeRequestKeyRef.current = null;
      setStatus('error');
      setError('Falha ao iniciar sessao de terminal');
      terminal.writeln('\r\n\x1b[31mFalha ao iniciar sessao de terminal.\x1b[0m\r\n');
    }, 5000);

    const existingSession = getTerminalSessionSnapshot(requestKey);
    if (existingSession) {
      console.info('[TerminalDrawer] terminal:attach', {
        sessionId: existingSession.sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
        workspaceKey: nextRequest.key,
        socketConnected: socket.connected,
        socketId: socket.id,
      });
      socket.emit('terminal:attach', {
        sessionId: existingSession.sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      return;
    }

    console.info('[TerminalDrawer] terminal:create', {
      cwd: nextRequest.cwd ?? null,
      cols: terminal.cols,
      rows: terminal.rows,
      workspaceKey: nextRequest.key,
      socketConnected: socket.connected,
      socketId: socket.id,
    });
    socket.emit('terminal:create', {
      cwd: nextRequest.cwd ?? null,
      cols: terminal.cols,
      rows: terminal.rows,
      workspaceKey: nextRequest.key,
    });
  }, [cwd, status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || terminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#111111',
        foreground: '#e5e7eb',
        cursor: '#d1d5db',
        selectionBackground: 'rgba(148, 163, 184, 0.22)',
      },
      scrollback: 3000,
      convertEol: true,
      scrollOnUserInput: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();

    const handlePointerDown = () => {
      terminal.focus();
    };

    host.addEventListener('mousedown', handlePointerDown);
    host.addEventListener('touchstart', handlePointerDown, { passive: true });

    terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      socketRef.current.emit('terminal:input', { sessionId, data });
    });

    resizeObserverRef.current = new ResizeObserver(() => {
      fitAddon.fit();
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      socketRef.current.emit('terminal:resize', {
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    resizeObserverRef.current.observe(host);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (openRef.current && requestRef.current) {
      startTerminalSession(requestRef.current);
    }

    return () => {
      host.removeEventListener('mousedown', handlePointerDown);
      host.removeEventListener('touchstart', handlePointerDown);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [request, startTerminalSession]);

  useEffect(() => {
    const socket = socketRef.current;

    const handleReady = ({
      sessionId,
      cwd: resolvedCwd,
      workspaceKey,
      snapshot,
    }: {
      sessionId: string;
      cwd: string;
      workspaceKey?: string;
      snapshot?: string;
    }) => {
      console.info('[TerminalDrawer] terminal:ready', { sessionId, cwd: resolvedCwd, workspaceKey });
      if (workspaceKey) {
        saveTerminalSessionSnapshot(workspaceKey, { sessionId, cwd: resolvedCwd });
        void api.upsertTerminalTab({
          requestKey: workspaceKey,
          title: requestRef.current?.title || 'Terminal',
          cwd: resolvedCwd,
          isActive: true,
        }).catch(() => {});
      }

      const requestKey = pendingRequestKeyRef.current ?? activeRequestKeyRef.current;
      const isCurrentRequest = !workspaceKey || !requestKey || workspaceKey === requestKey;
      if (!isCurrentRequest) return;

      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      sessionIdRef.current = sessionId;
      if (requestKey) {
        activeRequestKeyRef.current = requestKey;
        if (!workspaceKey) {
          saveTerminalSessionSnapshot(requestKey, { sessionId, cwd: resolvedCwd });
          void api.upsertTerminalTab({
            requestKey,
            title: requestRef.current?.title || 'Terminal',
            cwd: resolvedCwd,
            isActive: true,
          }).catch(() => {});
        }
      }
      setCwd(resolvedCwd);
      setStatus('ready');
      setError(null);
      const terminal = terminalRef.current;
      if (!terminal) return;
      terminal.reset();
      const finalizeReady = () => {
        if (!mountedRef.current) return;
        window.requestAnimationFrame(() => {
          if (!mountedRef.current) return;
          repaintTerminal();
          window.setTimeout(() => {
            if (!mountedRef.current) return;
            repaintTerminal();
            runActivationNudges();
            replayTerminalViewport();
            socket.emit('terminal:resize', {
              sessionId,
              cols: terminal.cols,
              rows: terminal.rows,
            });
          }, 30);
        });
      };
      if (snapshot) {
        terminal.write(snapshot, finalizeReady);
      } else {
        finalizeReady();
      }
    };

    const handleData = ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (sessionId !== sessionIdRef.current) return;
      terminalRef.current?.write(data, () => {
        scheduleRepaint(10);
      });
    };

    const handleExit = ({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
      console.info('[TerminalDrawer] terminal:exit', { sessionId, exitCode });
      clearTerminalSessionSnapshotBySessionId(sessionId);
      if (sessionId !== sessionIdRef.current) return;
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      sessionIdRef.current = null;
      terminalRef.current?.write(`\r\n\x1b[33mSessao encerrada (code ${exitCode}).\x1b[0m\r\n`);
      setStatus('idle');
      activeRequestKeyRef.current = null;
      pendingRequestKeyRef.current = null;
    };

    const handleError = ({ sessionId, message }: { sessionId?: string; message: string }) => {
      console.error('[TerminalDrawer] terminal:error', { sessionId, message });
      if (sessionId && sessionIdRef.current && sessionId !== sessionIdRef.current) return;
      if (sessionId) {
        clearTerminalSessionSnapshotBySessionId(sessionId);
      }
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      setStatus('error');
      setError(message);
      activeRequestKeyRef.current = null;
      pendingRequestKeyRef.current = null;
      terminalRef.current?.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
    };

    const handleConnect = () => {
      console.info('[TerminalDrawer] socket connected', { id: socket.id });
    };

    const handleDisconnect = (reason: string) => {
      console.warn('[TerminalDrawer] socket disconnected', { reason });
    };

    const handleConnectError = (err: Error) => {
      console.error('[TerminalDrawer] socket connect_error', err);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('terminal:ready', handleReady);
    socket.on('terminal:data', handleData);
    socket.on('terminal:exit', handleExit);
    socket.on('terminal:error', handleError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('terminal:ready', handleReady);
      socket.off('terminal:data', handleData);
      socket.off('terminal:exit', handleExit);
      socket.off('terminal:error', handleError);
    };
  }, []);

  useEffect(() => {
    if (!open || !request) return;
    if (!terminalRef.current) {
      return;
    }
    const tid = window.setTimeout(() => startTerminalSession(request), 0);
    return () => window.clearTimeout(tid);
  }, [open, request, startTerminalSession]);

  useEffect(() => {
    if (!open) return;
    const tid = window.setTimeout(() => {
      repaintTerminal();
      runActivationNudges();
      replayTerminalViewport();
    }, 0);
    return () => {
      window.clearTimeout(tid);
      clearActivationNudges();
    };
  }, [clearActivationNudges, expanded, open, repaintTerminal, replayTerminalViewport, runActivationNudges]);

  useEffect(() => {
    if (!open) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleRepaint(20);
        runActivationNudges();
        replayTerminalViewport();
      }
    };

    const handleFocus = () => {
      scheduleRepaint(20);
      runActivationNudges();
      replayTerminalViewport();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [open, replayTerminalViewport, runActivationNudges, scheduleRepaint]);

  useEffect(() => {
    if (open) return;
    if (isPage) return;
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      socketRef.current.emit('terminal:close', { sessionId });
      if (activeRequestKeyRef.current) {
        clearTerminalSessionSnapshot(activeRequestKeyRef.current);
      }
      sessionIdRef.current = null;
    }
    activeRequestKeyRef.current = null;
    pendingRequestKeyRef.current = null;
    const tid = window.setTimeout(() => {
      consumeModifiers();
      setStatus('idle');
      setError(null);
      setCwd(null);
    }, 0);
    return () => window.clearTimeout(tid);
  }, [consumeModifiers, isPage, open]);

  useEffect(() => {
    if (!open || isPage) return;
    if (window.innerWidth >= 768) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isPage]);

  if (!request) return null;

  return (
    <div
      className={isPage
        ? 'flex h-full min-h-0 flex-col bg-[#111111]'
        : `fixed inset-0 z-[70] flex flex-col bg-[#111111] transition-opacity duration-200 ease-out ${
            open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          } md:relative md:inset-auto md:z-auto md:border-t md:border-[#232323] md:transition-[max-height,opacity] ${
            open ? 'md:max-h-[72vh]' : 'md:max-h-0'
          }`}
    >
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-[#232323] bg-[#161616] shrink-0 ${isPage ? '' : 'pt-[max(0.75rem,env(safe-area-inset-top))]'}`}>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-gray-100">Terminal</div>
          <div className="truncate text-[11px] text-gray-400">
            {cwd ?? request.cwd ?? 'Aguardando sessao...'}
          </div>
        </div>

        <div className="text-[11px] text-gray-500">{status}</div>

        <div className="hidden md:flex items-center gap-1">
          <button
            onClick={() => navigateTerminal('top')}
            className="px-2.5 py-1.5 text-[11px] rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
            type="button"
          >
            Top
          </button>
          <button
            onClick={() => navigateTerminal('page_up')}
            className="px-2.5 py-1.5 text-[11px] rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
            type="button"
          >
            PgUp
          </button>
          <button
            onClick={() => navigateTerminal('page_down')}
            className="px-2.5 py-1.5 text-[11px] rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
            type="button"
          >
            PgDn
          </button>
          <button
            onClick={() => navigateTerminal('bottom')}
            className="px-2.5 py-1.5 text-[11px] rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
            type="button"
          >
            Bottom
          </button>
        </div>

        {!isPage && (
          <button
            onClick={() => setExpanded((value) => !value)}
            className="hidden md:block px-2.5 py-1.5 text-[11px] rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
            type="button"
          >
            {expanded ? 'Compactar' : 'Expandir'}
          </button>
        )}
        {!isPage && (
          <button
            onClick={onClose}
            className="px-2.5 py-1.5 text-[11px] rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
            type="button"
          >
            Fechar
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-[12px] text-red-300 bg-red-500/10 border-b border-red-500/10">
          {error}
        </div>
      )}

      <div className="md:hidden border-b border-[#232323] bg-[#141414]">
        <div className="flex flex-col gap-1.5 px-2 py-2">
          {MOBILE_TERMINAL_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {row.map((key) => {
                const active = (key.id === 'ctrl' && ctrlLocked) || (key.id === 'alt' && altLocked) || (key.id === 'shift' && shiftLocked);
                return (
                  <button
                    key={key.id}
                    type="button"
                    className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-blue-500/60 bg-blue-500/20 text-blue-100'
                        : 'border-[#2a2a2a] bg-[#1b1b1b] text-gray-300 hover:border-[#3a3a3a] hover:bg-[#222]'
                    }`}
                    onClick={() => handleMobileKey(key)}
                  >
                    {key.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div
        className={`relative w-full flex-1 min-h-0 ${expanded ? 'md:h-[62vh]' : 'md:h-[30vh] md:min-h-[280px]'}`}
      >
        <div className="h-full w-full min-h-0 px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-4">
          <div ref={hostRef} className="terminal-host h-full w-full min-h-0 overflow-hidden rounded-lg" />
        </div>
      </div>
    </div>
  );
}
