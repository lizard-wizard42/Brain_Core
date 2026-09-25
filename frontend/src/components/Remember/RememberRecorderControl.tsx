import { useEffect, useMemo, useRef, useState } from 'react';
import type { RememberStatus } from '../../types';
import { rememberService } from '../../services/rememberService';
import { emitRememberStatus } from './rememberEvents';
import { spDateTime } from './rememberTime';

function duration(startedAt: string | null, now: number): string {
  if (!startedAt) return '00:00:00';
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours, minutes, seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
}

export function RememberRecorderControl() {
  const [status, setStatus] = useState<RememberStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lastBroadcastState = useRef<string | null>(null);

  const publishStatus = (next: RememberStatus) => {
    setStatus(next);
    if (lastBroadcastState.current !== next.state) {
      lastBroadcastState.current = next.state;
      emitRememberStatus(next);
    }
  };

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await rememberService.getStatus();
        if (active) { publishStatus(next); setError(null); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Falha ao consultar o app Android');
      }
    };
    void refresh();
    const poll = window.setInterval(refresh, status?.state === 'recording' ? 7000 : 20000);
    return () => { active = false; window.clearInterval(poll); };
  }, [status?.state]);

  useEffect(() => {
    if (status?.state !== 'recording') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status?.state]);

  const label = useMemo(() => {
    if (!status) return 'Consultando app Android…';
    if (status.state === 'offline') return 'App Android offline';
    if (status.state === 'recording') return 'Gravando';
    if (status.state === 'stopped') return 'App Android online · captura parada';
    return status.state === 'transcribing' ? 'Transcrevendo…' : status.state === 'syncing' ? 'Sincronizando…' : 'Processando…';
  }, [status]);

  const toggle = async () => {
    if (!status || status.state === 'offline') return;
    setBusy(true); setError(null);
    try {
      const next = await (status.state === 'recording' ? rememberService.stop() : rememberService.start());
      lastBroadcastState.current = next.state;
      setStatus(next);
      emitRememberStatus(next);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível controlar a captura'); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label="Controle de captura de memória" className="rounded-[26px] border border-white/10 bg-white/[0.045] p-5 sm:p-7">
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-300">
        <span aria-hidden="true" className={status?.state === 'recording' ? 'text-red-400' : 'text-gray-500'}>●</span>
        <span>{label}</span>
      </div>
      {status?.state === 'recording' && <div className="mt-3 font-mono text-4xl text-white">{duration(status.started_at, now)}</div>}
      {status?.last_communication_at && <p className="mt-2 text-xs text-gray-500">Última comunicação: {spDateTime(status.last_communication_at)}</p>}
      {status?.message && <p className="mt-2 text-xs text-gray-400">{status.message}</p>}
      <button type="button" disabled={busy || !status || status.state === 'offline'} onClick={toggle} className={`mt-6 min-h-14 w-full rounded-2xl px-6 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-56 ${status?.state === 'recording' ? 'bg-red-700 hover:bg-red-600' : 'bg-blue-700 hover:bg-blue-600'}`}>
        {busy ? 'Aguarde…' : status?.state === 'recording' ? 'PARAR' : 'INICIAR'}
      </button>
      {error && <div role="alert" className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
    </section>
  );
}
