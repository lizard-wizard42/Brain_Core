import { useCallback, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

// BASE_URL é o base path do Vite (/ padrão ou subpasta como /brain) — usamos para prefixar o path do socket
const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, ''); // "" ou "/brain"
const SOCKET_PATH = `${BASE_URL}/socket.io`;
// Host absoluto do backend — mesma razão do client.ts: front e backend são
// portas/serviços separados sem nginx unificando os dois num só origin.
const API_HOST = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

let socket: Socket | null = null;

export function getAppSocket(): Socket {
  if (!socket) {
    socket = io(API_HOST, {
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
      autoConnect: false,
      withCredentials: true,
    });
  }
  if (!socket.connected) socket.connect();
  return socket;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseSocketOptions {
  onSaved?: (pageId: string, updatedAt: string) => void;
  onError?: (pageId: string, message: string) => void;
}

export function useSocket(options?: UseSocketOptions) {
  const optionsRef = useRef(options);
  const sock = getAppSocket();

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const handleSaved = ({ pageId, updated_at }: { pageId: string; updated_at: string }) => {
      optionsRef.current?.onSaved?.(pageId, updated_at);
    };
    const handleError = ({ pageId, message }: { pageId: string; message: string }) => {
      optionsRef.current?.onError?.(pageId, message);
    };

    sock.on('page:saved', handleSaved);
    sock.on('page:error', handleError);

    return () => {
      sock.off('page:saved', handleSaved);
      sock.off('page:error', handleError);
    };
  }, [sock]);

  const safeEmit = useCallback((event: string, payload: unknown) => {
    // Avoid flooding warnings when the transport is closing/closed.
    if (!sock.connected) return;
    const engine = (sock.io as unknown as { engine?: { transport?: { ws?: { readyState?: number } } } }).engine;
    const readyState = engine?.transport?.ws?.readyState;
    if (typeof readyState === 'number' && readyState !== 1) return;
    sock.emit(event, payload);
  }, [sock]);

  const joinPage = useCallback((pageId: string) => {
    safeEmit('page:join', { pageId });
  }, [safeEmit]);

  const leavePage = useCallback((pageId: string) => {
    safeEmit('page:leave', { pageId });
  }, [safeEmit]);

  const savePage = useCallback((pageId: string, content: unknown, title: string) => {
    safeEmit('page:save', { pageId, content, title });
  }, [safeEmit]);

  return useMemo(() => ({
    joinPage,
    leavePage,
    savePage,
  }), [joinPage, leavePage, savePage]);
}
