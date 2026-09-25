import { useCallback, useEffect, useRef, useState } from 'react';
import type { RememberVoiceprint } from '../../types';
import { rememberService } from '../../services/rememberService';
import { spDateTime } from './rememberTime';

const MAX_SECONDS = 30;
const MIN_SECONDS = 8;

type Phase = 'idle' | 'recording' | 'uploading';

export function RememberVoiceprintPanel() {
  const [voiceprint, setVoiceprint] = useState<RememberVoiceprint | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);

  const loadStatus = useCallback(async () => {
    try { setVoiceprint(await rememberService.getVoiceprint()); }
    catch { setVoiceprint({ enrolled: false, updated_at: null, sample_seconds: null, model: null }); }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => () => { if (tickRef.current) window.clearInterval(tickRef.current); }, []);

  const finish = useCallback(async () => {
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    const recorder = recorderRef.current;
    if (!recorder) return;
    const seconds = elapsed;
    const stream = recorder.stream;
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;

    if (seconds < MIN_SECONDS) {
      setPhase('idle');
      setError(`Grave pelo menos ${MIN_SECONDS}s (você gravou ${seconds}s).`);
      return;
    }
    setPhase('uploading');
    setError(null);
    // give the recorder a tick to flush its last dataavailable
    window.setTimeout(async () => {
      try {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
        await rememberService.enrollVoiceprint(blob);
        await loadStatus();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Falha ao enviar a amostra');
      } finally {
        setPhase('idle');
      }
    }, 150);
  }, [elapsed, loadStatus]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador não permite gravar áudio.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Permissão de microfone negada.');
      return;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.start();
    recorderRef.current = recorder;
    setElapsed(0);
    setPhase('recording');
    tickRef.current = window.setInterval(() => {
      setElapsed((value) => {
        if (value + 1 >= MAX_SECONDS) { void finish(); return MAX_SECONDS; }
        return value + 1;
      });
    }, 1000);
  }, [finish]);

  const remove = useCallback(async () => {
    setError(null);
    try { await rememberService.deleteVoiceprint(); await loadStatus(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao remover'); }
  }, [loadStatus]);

  const enrolled = voiceprint?.enrolled ?? false;

  return (
    <section aria-label="Minha voz" className="mt-6 rounded-[26px] border border-white/10 bg-white/[0.03] p-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium text-white">
          Minha voz {enrolled
            ? <span className="ml-2 text-xs text-emerald-300">configurada</span>
            : <span className="ml-2 text-xs text-gray-400">não configurada</span>}
        </span>
        <span aria-hidden="true" className="text-gray-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-6 text-gray-400">
            Grave ~30 segundos só com a sua voz. O Remember usa essa amostra para marcar, nas
            transcrições, o que é você e o que é outra pessoa.
          </p>

          {phase === 'recording' && (
            <div role="status" className="flex items-center gap-3 text-sm text-gray-200">
              <span aria-hidden="true" className="text-red-400">●</span>
              <span className="font-mono text-2xl text-white">{String(elapsed).padStart(2, '0')}s</span>
              <span className="text-xs text-gray-500">de {MAX_SECONDS}s (mín. {MIN_SECONDS}s)</span>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {phase === 'idle' && (
              <button type="button" onClick={() => void start()} className="rounded-2xl bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-600">
                {enrolled ? 'Regravar minha voz' : 'Gravar minha voz'}
              </button>
            )}
            {phase === 'recording' && (
              <button type="button" onClick={() => void finish()} className="rounded-2xl bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-600">
                Parar e enviar
              </button>
            )}
            {phase === 'uploading' && <span className="text-sm text-gray-400">Enviando amostra…</span>}
            {enrolled && phase === 'idle' && (
              <button type="button" onClick={() => void remove()} className="rounded-2xl border border-white/15 px-5 py-2 text-sm text-gray-300 hover:bg-white/5">
                Remover
              </button>
            )}
          </div>

          {enrolled && voiceprint?.updated_at && (
            <p className="text-xs text-gray-500">
              Última atualização: {spDateTime(voiceprint.updated_at)}
              {voiceprint.sample_seconds ? ` · ${voiceprint.sample_seconds}s` : ''}
            </p>
          )}
          {error && <div role="alert" className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-2 text-sm text-red-300">{error}</div>}
        </div>
      )}
    </section>
  );
}
