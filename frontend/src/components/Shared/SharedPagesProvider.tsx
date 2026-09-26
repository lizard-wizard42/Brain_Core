import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { SharedPageSummary } from '../../types';
import { mergeSharedPages } from './sharedModel';
import { SharedPagesContext, type SharedPagesState } from './sharedPagesContext';

function messageOf(error: unknown, fallback: string): string {
  const text = String(error);
  if (/API 404/.test(text)) return 'Recurso de compartilhamento indisponível';
  if (/API 40[13]/.test(text)) return 'Sem permissão para listar compartilhados';
  return fallback;
}

export function SharedPagesProvider({ children }: { children: React.ReactNode }) {
  const [received, setReceived] = useState<SharedPageSummary[]>([]);
  const [sent, setSent] = useState<SharedPageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentError, setSentError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (typeof api.getSharedPages !== 'function') {
        if (active) { setError('Recurso de compartilhamento indisponível'); setLoading(false); }
        return;
      }
      setLoading(true);
      const [receivedResult, sentResult] = await Promise.allSettled([
        api.getSharedPages('received'),
        api.getSharedPages('sent'),
      ]);
      if (!active) return;
      if (receivedResult.status === 'fulfilled') {
        setReceived(receivedResult.value);
        setError(null);
      } else {
        setReceived([]);
        setError(messageOf(receivedResult.reason, 'Não foi possível carregar os compartilhados'));
      }
      if (sentResult.status === 'fulfilled') {
        setSent(sentResult.value);
        setSentError(null);
      } else {
        setSent([]);
        setSentError(messageOf(sentResult.reason, 'Compartilhados enviados indisponíveis'));
      }
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [reloadToken]);

  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  const value = useMemo<SharedPagesState>(() => {
    const { received: dedupedReceived, sent: dedupedSent } = mergeSharedPages(received, sent);
    const byId = new Map<string, SharedPageSummary>();
    for (const item of dedupedSent) byId.set(item.id, item);
    for (const item of dedupedReceived) byId.set(item.id, item);
    return {
      received: dedupedReceived,
      sent: dedupedSent,
      loading,
      error,
      sentError,
      byId,
      getEntry: (id) => (id ? byId.get(id) : undefined),
      refresh,
    };
  }, [received, sent, loading, error, sentError, refresh]);

  return <SharedPagesContext.Provider value={value}>{children}</SharedPagesContext.Provider>;
}
