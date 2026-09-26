import { useCallback, useEffect, useRef, useState } from 'react';
import type { RememberVoiceprint } from '../../types';
import { rememberService } from '../../services/rememberService';
import { browserRecording } from '../../services/browserRecording';
import { cancelNativeVoiceSample, getNativeStatus, isNativeAndroidApp, isNativeBridgeAvailable, startNativeVoiceSample, stopNativeVoiceSample } from '../../services/nativeBridge';

const MAX_SECONDS = 30;
const MIN_SECONDS = 8;

type Phase = 'idle' | 'recording' | 'uploading';

export function RememberVoiceprintPanel({ onRelabelChange, refreshToken = 0 }: { onRelabelChange?: () => void; refreshToken?: number } = {}) {
  const [voiceprint, setVoiceprint] = useState<RememberVoiceprint | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nativeRecordingRef = useRef(false);
  const previousRelabelCount = useRef<number | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const next = await rememberService.getVoiceprint();
      const remaining = (next.relabel?.pending ?? 0) + (next.relabel?.processing ?? 0);
      if (previousRelabelCount.current !== null && remaining !== previousRelabelCount.current) onRelabelChange?.();
      previousRelabelCount.current = remaining;
      setVoiceprint(next);
    }
    catch { setVoiceprint((current) => current ?? { enrolled: false, updated_at: null, sample_seconds: null, model: null }); }
  }, [onRelabelChange]);

  useEffect(() => { void loadStatus(); }, [loadStatus, refreshToken]);
  const relabelRemaining = (voiceprint?.relabel?.pending ?? 0) + (voiceprint?.relabel?.processing ?? 0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadStatus();
    }, relabelRemaining > 0 ? 5000 : 30000);
    return () => window.clearInterval(timer);
  }, [relabelRemaining, loadStatus]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) void loadStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadStatus]);
  useEffect(() => () => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
    recorder?.stream.getTracks().forEach((track) => track.stop());
    if (nativeRecordingRef.current) void cancelNativeVoiceSample();
  }, []);

  const finish = useCallback(async (secondsOverride?: number) => {
    if (tickRef.current !== null) { window.clearInterval(tickRef.current); tickRef.current = null; }
    if (nativeRecordingRef.current) {
      nativeRecordingRef.current = false;
      setPhase('uploading');
      try {
        const result = await stopNativeVoiceSample();
        if (!result.success) throw new Error(result.error || 'Não foi possível enviar a amostra');
        await loadStatus();
        onRelabelChange?.();
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Falha ao enviar a amostra');
      } finally { setPhase('idle'); }
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder) return;
    const seconds = secondsOverride ?? elapsedRef.current;
    const stream = recorder.stream;
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    try { recorder.stop(); }
    catch (reason) {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setPhase('idle');
      setError(reason instanceof Error ? reason.message : 'Não foi possível finalizar a amostra.');
      return;
    }
    stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    startedAtRef.current = null;

    await stopped;

    if (seconds < MIN_SECONDS) {
      setPhase('idle');
      setError(`Grave pelo menos ${MIN_SECONDS}s (você gravou ${seconds}s).`);
      return;
    }
    setPhase('uploading');
    setError(null);
    try {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
      await rememberService.enrollVoiceprint(blob);
      await loadStatus();
      onRelabelChange?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao enviar a amostra');
    } finally {
      setPhase('idle');
    }
  }, [loadStatus, onRelabelChange]);

  const start = useCallback(async () => {
    setError(null);
    if (browserRecording.getState().phase !== 'idle') {
      setError('O Brain Core já está gravando nesta página. Pare e salve a gravação antes de cadastrar sua voz.');
      return;
    }
    if (isNativeAndroidApp() && isNativeBridgeAvailable()) {
      try {
        const status = await getNativeStatus();
        if (status.nativeRecordingActive) {
          setError('O Brain Core está gravando no aparelho. Pare e salve a gravação antes de cadastrar sua voz.');
          return;
        }
        if (status.microphonePermission === 'denied') {
          setError('O Brain Core está sem permissão de microfone no Android. Abra Configurações → Este aparelho para conceder a permissão.');
          return;
        }
        const result = await startNativeVoiceSample();
        if (!result.success) throw new Error(result.error || 'Não foi possível iniciar a gravação');
        nativeRecordingRef.current = true;
        startedAtRef.current = Date.now();
        elapsedRef.current = 0;
        setElapsed(0);
        setPhase('recording');
        tickRef.current = window.setInterval(() => {
          const seconds = Math.min(MAX_SECONDS, Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
          elapsedRef.current = seconds;
          setElapsed(seconds);
          if (seconds >= MAX_SECONDS) void finish(seconds);
        }, 1000);
        return;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'O gravador do Android não pôde iniciar.');
        return;
      }
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setError('A gravação direta pelo microfone exige conexão segura (HTTPS ou localhost). Acesse via HTTPS (Tailscale) ou use o envio de arquivo de áudio abaixo.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador não permite gravar áudio.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      const domErr = err as { name?: string; message?: string };
      const name = domErr?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Permissão de microfone negada pelo navegador ou sistema. Verifique as permissões de microfone nas configurações do site (ícone ao lado da barra de endereço) ou use "Enviar arquivo de áudio" abaixo.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('Nenhum microfone encontrado neste dispositivo. Conecte um microfone ou use "Enviar arquivo de áudio" abaixo.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setError('O microfone não pôde ser iniciado. Verifique se há outra gravação ou chamada ativa, feche-a e tente novamente. Se continuar, use "Enviar arquivo de áudio" abaixo.');
      } else if (name === 'SecurityError') {
        setError('Acesso ao microfone bloqueado por segurança (requer HTTPS ou localhost). Use "Enviar arquivo de áudio" abaixo.');
      } else {
        setError(`Permissão de microfone negada ou inacessível (${domErr?.message || name || 'erro'}). Use "Enviar arquivo de áudio" abaixo.`);
      }
      return;
    }
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.start();
    } catch (reason) {
      stream.getTracks().forEach((track) => track.stop());
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o microfone.');
      return;
    }
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    elapsedRef.current = 0;
    setElapsed(0);
    setPhase('recording');
    tickRef.current = window.setInterval(() => {
      const seconds = Math.min(MAX_SECONDS, Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
      elapsedRef.current = seconds;
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS) void finish(seconds);
    }, 1000);
  }, [finish]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > 25 * 1024 * 1024) {
      setError('O arquivo de áudio deve ter no máximo 25MB.');
      event.target.value = '';
      return;
    }
    setPhase('uploading');
    try {
      await rememberService.enrollVoiceprint(file);
      await loadStatus();
      onRelabelChange?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao enviar arquivo de áudio');
    } finally {
      setPhase('idle');
      event.target.value = '';
    }
  }, [loadStatus, onRelabelChange]);

  const remove = useCallback(async () => {
    setError(null);
    try { await rememberService.deleteVoiceprint(); await loadStatus(); onRelabelChange?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao remover'); }
  }, [loadStatus, onRelabelChange]);

  const enrolled = voiceprint?.enrolled ?? false;

  return (
    <section aria-label="Minha voz" className="mt-6 rounded-[26px] border p-5" style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium" style={{ color: 'var(--theme-text)' }}>
          Minha voz {enrolled
            ? <span className="ml-2 text-xs text-emerald-300">configurada</span>
            : <span className="ml-2 text-xs text-gray-400">não configurada</span>}
          {relabelRemaining > 0 && <span className="ml-2 text-xs text-blue-300">atualizando {relabelRemaining}</span>}
        </span>
        <span aria-hidden="true" className="text-gray-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-6" style={{ color: 'var(--theme-muted)' }}>
            Grave ~30 segundos só com a sua voz ou envie um áudio gravado. A amostra fica vinculada à sua conta.
            Por enquanto, o Brain Core não marca automaticamente quem falou: confirme ou corrija as falas na transcrição.
          </p>

          {!enrolled && (
            <p className="text-xs text-amber-300/80">
              Sem amostra cadastrada, você ainda pode identificar as falas manualmente.
            </p>
          )}

          {relabelRemaining > 0 && (
            <p role="status" className="text-xs" style={{ color: 'var(--theme-muted)' }}>
              Atualizando {relabelRemaining} bloco(s) de áudio sem atribuir identidade automaticamente.
            </p>
          )}
          {(voiceprint?.relabel?.failed ?? 0) > 0 && (
            <p role="alert" className="text-xs text-amber-300">
              {voiceprint?.relabel?.failed} bloco(s) não puderam ser reclassificados. Confira o serviço de memória no PC.
            </p>
          )}

          {phase === 'recording' && (
            <div role="status" className="flex items-center gap-3 text-sm text-gray-200">
              <span aria-hidden="true" className="text-red-400">●</span>
              <span className="font-mono text-2xl text-white">{String(elapsed).padStart(2, '0')}s</span>
              <span className="text-xs text-gray-500">de {MAX_SECONDS}s (mín. {MIN_SECONDS}s)</span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => void handleFileUpload(e)}
            aria-label="Upload de amostra de voz"
          />

          <div className="flex flex-wrap items-center gap-3">
            {phase === 'idle' && (
              <>
                <button type="button" onClick={() => void start()} className="rounded-2xl bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-600">
                  {enrolled ? 'Regravar minha voz' : 'Gravar minha voz'}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-2xl border px-4 py-2 text-sm font-semibold" style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text)', backgroundColor: 'var(--theme-card)' }}
                >
                  📁 Enviar arquivo de áudio
                </button>
              </>
            )}
            {phase === 'recording' && (
              <button type="button" onClick={() => void finish()} className="rounded-2xl bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-600">
                Parar e enviar
              </button>
            )}
            {phase === 'uploading' && <span role="status" className="text-sm" style={{ color: 'var(--theme-muted)' }}>Enviando e analisando sua voz no PC… Isso pode levar até 2 minutos.</span>}
            {enrolled && phase === 'idle' && (
              <button type="button" onClick={() => void remove()} className="rounded-2xl border border-white/15 px-5 py-2 text-sm text-gray-300 hover:bg-white/5">
                Remover
              </button>
            )}
          </div>

          {enrolled && voiceprint?.updated_at && (
            <p className="text-xs text-gray-500">
              Última atualização: {new Date(voiceprint.updated_at).toLocaleString('pt-BR')}
              {voiceprint.sample_seconds ? ` · ${voiceprint.sample_seconds}s` : ''}
            </p>
          )}
          {error && <div role="alert" className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-2 text-sm text-red-300">{error}</div>}
        </div>
      )}
    </section>
  );
}
