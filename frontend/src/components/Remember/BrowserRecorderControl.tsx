import { useEffect, useState } from 'react';
import { browserRecording } from '../../services/browserRecording';
import { emitRememberStatus } from './rememberEvents';

function elapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return '00:00';
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function BrowserRecorderControl() {
  const [state, setState] = useState(browserRecording.getState());
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => browserRecording.subscribe(setState), []);
  useEffect(() => { void browserRecording.recover().catch(() => setError('O armazenamento local deste navegador não está disponível.')); }, []);
  useEffect(() => {
    if (state.phase !== 'recording') return;
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [state.phase]);

  const toggle = async () => {
    setError(null);
    try {
      if (state.phase === 'recording') {
        await browserRecording.stop();
        emitRememberStatus({ state: 'processing', started_at: null, last_communication_at: new Date().toISOString(), device_id: 'browser' });
      } else await browserRecording.start();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao gravar.');
    }
  };

  return (
    <section aria-label="Gravação no PC" className="rounded-[26px] border p-5 sm:p-7" style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-text)' }}>Gravação neste PC</h2>
      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--theme-muted)' }}>Usa o microfone deste navegador. Os blocos ficam salvos neste PC até o envio; a GPU processa a transcrição depois.</p>
      {state.phase === 'recording' && <p role="status" className="mt-4 font-mono text-3xl text-red-300">● {elapsed(state.startedAt, now)}</p>}
      <button type="button" onClick={() => void toggle()} disabled={state.phase === 'saving'} className={`mt-5 min-h-14 w-full rounded-2xl px-6 text-base font-semibold text-white disabled:opacity-50 sm:w-56 ${state.phase === 'recording' ? 'bg-red-700 hover:bg-red-600' : 'bg-blue-700 hover:bg-blue-600'}`}>
        {state.phase === 'saving' ? 'Salvando…' : state.phase === 'recording' ? 'Parar gravação' : 'Gravar no PC'}
      </button>
      {state.pending > 0 && <p className="mt-3 text-sm text-amber-200">{state.pending} item(ns) aguardando sincronização neste navegador.</p>}
      {state.pending > 0 && state.phase === 'idle' && <button type="button" onClick={() => void browserRecording.retry().catch(() => setError('Não foi possível verificar o áudio pendente.'))} className="mt-2 min-h-11 rounded-lg border border-white/20 px-4 text-sm text-white">Reenviar áudio</button>}
      {state.unassigned > 0 && <div className="mt-3 text-sm text-amber-200">
        <p>Há {state.unassigned} item(ns) de gravações antigas sem conta definida, preservados neste navegador.</p>
        <button type="button" className="mt-2 min-h-11 rounded-lg border border-amber-300/40 px-3" onClick={() => {
          if (!window.confirm('Confirme que essas gravações são suas antes de enviá-las para a conta atual.')) return;
          void browserRecording.claimUnassigned().catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível atribuir as gravações. O áudio foi preservado.'));
        }}>Atribuir gravações antigas à minha conta</button>
      </div>}
      {state.message && <p role="status" className="mt-3 text-sm text-gray-300">{state.message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  );
}
