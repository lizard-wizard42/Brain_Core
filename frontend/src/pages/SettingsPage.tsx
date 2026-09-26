import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, type MobileDevice } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { themes, themeChoices } from '../theme/themes';
import { ContactsSection } from '../components/Shared/ContactsSection';
import {
  type NativeDeviceStatus,
  cleanLocalAudio,
  getNativeStatus,
  isNativeAndroidApp,
  isNativeBridgeAvailable,
  linkDevice,
  requestMicrophonePermission,
  unlinkDevice,
} from '../services/nativeBridge';

import settingsIconUrl from '../assets/icons/settings.svg';

const SETTINGS_ICON_URL = settingsIconUrl;

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  telegram_chat_id: string | null;
  telegram_notifications_enabled: boolean;
  two_factor_enabled: boolean;
  two_factor_setup_pending: boolean;
}

function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('As senhas não coincidem');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      await api.changePassword(current, next);
      setStatus('success');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao trocar senha');
      setStatus('error');
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Segurança</h2>
      <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5">
        <p className="text-[13px] text-white mb-4">Alterar senha</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-gray-600 uppercase tracking-wider">Senha atual</label>
            <input
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              required
              className="w-full bg-[#151515] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-[#444]"
              placeholder="••••••"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-gray-600 uppercase tracking-wider">Nova senha</label>
            <input
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              required
              className="w-full bg-[#151515] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-[#444]"
              placeholder="••••••"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-gray-600 uppercase tracking-wider">Confirmar nova senha</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full bg-[#151515] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-[#444]"
              placeholder="••••••"
            />
          </div>

          {status === 'error' && (
            <p className="text-[12px] text-red-400">{error}</p>
          )}
          {status === 'success' && (
            <p className="text-[12px] text-green-400">Senha alterada com sucesso!</p>
          )}

          <div className="flex justify-end mt-1">
            <button
              type="submit"
              disabled={status === 'loading'}
              className="px-4 py-2 text-[13px] bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'loading' ? 'Salvando…' : 'Salvar senha'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function PcAudioRetentionSection() {
  const [automatic, setAutomatic] = useState(false);
  const [days, setDays] = useState(90);
  const [preview, setPreview] = useState<{ files: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClean, setConfirmClean] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.getPcAudioRetention().then(policy => {
      setAutomatic(policy.automatic);
      setDays(policy.days);
    }).catch(() => setMessage('Não foi possível consultar o serviço de áudio do PC.'));
  }, []);
  useEffect(() => {
    api.previewPcAudioCleanup(days).then(setPreview).catch(() => setPreview(null));
  }, [days]);

  const save = async (nextAutomatic: boolean, nextDays: number) => {
    setBusy(true);
    setMessage('');
    try {
      const policy = await api.setPcAudioRetention(nextAutomatic, nextDays);
      setAutomatic(policy.automatic);
      setDays(policy.days);
      setMessage('Política salva no PC.');
    } catch { setMessage('Não foi possível salvar a política no PC.'); }
    finally { setBusy(false); }
  };

  const clean = async () => {
    setConfirmClean(false);
    setBusy(true);
    try {
      const result = await api.cleanPcAudio(days);
      setMessage(`${result.files} arquivo(s) removido(s) do PC; ${(result.bytes / 1048576).toFixed(1)} MiB liberados.`);
      setPreview(await api.previewPcAudioCleanup(days));
    } catch { setMessage('A limpeza do PC falhou. Tente novamente.'); }
    finally { setBusy(false); }
  };

  return <section className="flex flex-col gap-4">
    <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Áudio no PC</h2>
    <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5 flex flex-col gap-4">
      <p className="text-[13px] text-white">Limpeza de áudio antigo</p>
      <p className="text-[12px] text-gray-400">Remove apenas arquivos de sessões concluídas cujos blocos foram transcritos. Os textos e o histórico permanecem; não será possível ouvir ou reprocessar o áudio removido no PC.</p>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={automatic} disabled={busy} onChange={e => void save(e.target.checked, days)} /> Limpeza automática diária</label>
      <label className="flex items-center gap-3 text-[13px]">Remover após
        <select aria-label="Prazo do áudio no PC" value={days} disabled={busy} onChange={e => void save(automatic, Number(e.target.value))}
          className="rounded-lg border border-[#444] bg-[#151515] px-3 py-2 text-white">
          {[30, 90, 180, 365].map(value => <option key={value} value={value}>{value} dias</option>)}
        </select>
      </label>
      <p className="text-[12px] text-gray-400">Elegíveis agora: {preview ? `${preview.files} blocos · ${(preview.bytes / 1048576).toFixed(1)} MiB` : 'calculando…'}</p>
      {confirmClean ? <div className="flex flex-wrap items-center gap-3 text-[12px] text-amber-300">
        <span>Confirmar remoção dos arquivos elegíveis no PC?</span>
        <button type="button" disabled={busy} onClick={() => void clean()} className="rounded-lg border border-red-700 px-3 py-2">Confirmar</button>
        <button type="button" onClick={() => setConfirmClean(false)} className="rounded-lg border border-[#444] px-3 py-2">Cancelar</button>
      </div> : <button type="button" disabled={busy || !preview?.files} onClick={() => setConfirmClean(true)}
        className="self-start rounded-lg border border-[#444] px-3 py-2 text-[13px] disabled:opacity-50">Limpar agora no PC</button>}
      {message && <p role="status" className="text-[12px] text-gray-300">{message}</p>}
    </div>
  </section>;
}

function ThisDeviceSection({ user }: { user: UserInfo | null }) {
  if (!isNativeAndroidApp()) return null;
  return <ThisDeviceSectionContent user={user} />;
}

function ThisDeviceSectionContent({ user }: { user: UserInfo | null }) {
  const [status, setStatus] = useState<NativeDeviceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const [showCleanConfirm, setShowCleanConfirm] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!isNativeBridgeAvailable()) {
      setLoading(false);
      return;
    }
    try {
      const data = await getNativeStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao consultar estado nativo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleLink = async (confirmSwitch = false) => {
    if (!user) {
      setError('Faça login no Brain Core antes de vincular.');
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await linkDevice(user.id, confirmSwitch);
      if (res.success) {
        setMessage('Aparelho vinculado com sucesso a esta conta.');
        setShowSwitchConfirm(false);
        await loadStatus();
      } else if (res.error === 'account_switch_required') {
        setShowSwitchConfirm(true);
        setError(res.message || 'Este aparelho possui gravações de outra conta. Confirme a troca.');
      } else {
        setError(res.message || 'Falha ao vincular aparelho.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na comunicação com o aparelho ou PC.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await unlinkDevice();
      setMessage('Aparelho desvinculado. Áudios locais continuam preservados.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao desvincular aparelho.');
    } finally {
      setBusy(false);
    }
  };

  const handleClean = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    setShowCleanConfirm(false);
    try {
      const res = await cleanLocalAudio();
      if (res.success) {
        const mib = ((res.freedBytes || 0) / 1048576).toFixed(1);
        setMessage(`Limpeza local concluída: ${res.deletedChunks || 0} bloco(s) removido(s) (${mib} MiB liberados).`);
        await loadStatus();
      } else {
        setError(res.error || 'Falha ao executar limpeza local.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na limpeza local.');
    } finally {
      setBusy(false);
    }
  };

  const handleRequestMic = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await requestMicrophonePermission();
      setStatus(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao solicitar permissão');
    } finally {
      setBusy(false);
    }
  };

  const isLinkedToCurrent = Boolean(status?.linked && status?.recordingOwnerUserId === user?.id);
  const isLinkedToOther = Boolean(status?.linked && status?.recordingOwnerUserId && status?.recordingOwnerUserId !== user?.id);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Este aparelho</h2>
      <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5 flex flex-col gap-4">
        <div>
          <p className="text-[13px] font-medium text-white">Gravações neste Android</p>
          <p className="text-[12px] text-gray-400 mt-0.5">
            Gerencie o vínculo com a conta ativa, consulte blocos pendentes, espaço livre e execute limpeza local.
          </p>
        </div>

        {/* Status de vinculação */}
        <div className="rounded-xl border border-[#2d2d2d] bg-[#161616] p-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-gray-400">Status de vinculação</span>
            {loading ? (
              <span className="text-[12px] text-gray-500">Consultando…</span>
            ) : isLinkedToCurrent ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Vinculado a esta conta
              </span>
            ) : isLinkedToOther ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span> Vinculado a outra conta
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-400">
                <span className="w-2 h-2 rounded-full bg-gray-500"></span> Não vinculado
              </span>
            )}
          </div>

          {status && (
            <div className="text-[12px] text-gray-400 flex flex-col gap-1 border-t border-[#252525] pt-2">
              <div className="flex justify-between">
                <span>Blocos pendentes de envio:</span>
                <span className="text-white font-medium">
                  {status.pendingChunks > 0
                    ? `${status.pendingChunks} bloco(s) · ${(status.audioBytes / 1048576).toFixed(1)} MiB`
                    : 'Nenhum'}
                  {status.conflictChunks > 0 ? ` (${status.conflictChunks} com conflito)` : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Espaço livre no aparelho:</span>
                <span className={`font-medium ${status.isLowSpace ? 'text-amber-400' : 'text-white'}`}>
                  {(status.freeSpaceBytes / (1024 * 1024 * 1024)).toFixed(1)} GB livres
                </span>
              </div>
              <div className="flex justify-between">
                <span>Limpeza local elegível:</span>
                <span className="text-white font-medium">
                  {status.eligibleCleanupChunks > 0
                    ? `${status.eligibleCleanupChunks} bloco(s) · ${(status.eligibleCleanupBytes / 1048576).toFixed(1)} MiB`
                    : 'Nenhum bloco elegível'}
                </span>
              </div>
            </div>
          )}

          {/* Permissão de microfone negada */}
          {status?.microphonePermission === 'denied' && (
            <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-[12px] text-amber-300 flex flex-col gap-2">
              <span>⚠️ Permissão de microfone negada no Android. O gravador não conseguirá capturar áudio.</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRequestMic()}
                className="self-start rounded-md border border-amber-700 px-2.5 py-1 text-[11px] text-amber-200 hover:bg-amber-900/40"
              >
                Solicitar permissão de microfone
              </button>
            </div>
          )}

          {/* Tablet com pouco espaço */}
          {status?.isLowSpace && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-[12px] text-red-300">
              ⚠️ Armazenamento baixo no tablet ({(status.freeSpaceBytes / (1024 * 1024)).toFixed(0)} MiB livres). Execute a limpeza local ou libere espaço no dispositivo para continuar gravando.
            </div>
          )}

          {/* Ações de vinculação */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {!isLinkedToCurrent ? (
              <button
                type="button"
                disabled={busy || loading || !user}
                onClick={() => void handleLink(false)}
                className="rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {busy ? 'Vinculando…' : 'Vincular gravações a esta conta'}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => void handleUnlink()}
                className="rounded-lg border border-[#444] px-3 py-2 text-[13px] text-gray-300 hover:bg-white/[0.04] disabled:opacity-50"
              >
                Desvincular deste aparelho
              </button>
            )}

            {status && status.eligibleCleanupChunks > 0 && !showCleanConfirm && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowCleanConfirm(true)}
                className="rounded-lg border border-[#444] px-3 py-2 text-[13px] text-gray-300 hover:bg-white/[0.04] disabled:opacity-50"
              >
                Limpar áudio local elegível
              </button>
            )}
          </div>

          {/* Confirmação de limpeza local */}
          {showCleanConfirm && (
            <div className="rounded-lg border border-amber-900/60 bg-[#1c1810] p-3 text-[12px] text-amber-200 flex flex-col gap-2">
              <span>Remover {status?.eligibleCleanupChunks} bloco(s) de áudio já sincronizados e transcritos do aparelho?</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleClean()}
                  className="rounded-md border border-amber-600 bg-amber-900/40 px-3 py-1.5 font-medium text-amber-200 hover:bg-amber-800/60"
                >
                  Confirmar limpeza
                </button>
                <button
                  type="button"
                  onClick={() => setShowCleanConfirm(false)}
                  className="rounded-md border border-[#444] px-3 py-1.5 text-gray-400 hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Confirmação de troca de conta */}
          {showSwitchConfirm && (
            <div className="rounded-lg border border-red-900/60 bg-[#231515] p-3 text-[12px] text-red-200 flex flex-col gap-2">
              <span>Este aparelho possui gravações associadas a outra conta. Ao vincular à conta atual ({user?.name || user?.email}), as próximas gravações serão associadas à nova conta. Confirmar troca?</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleLink(true)}
                  className="rounded-md border border-red-700 bg-red-900/40 px-3 py-1.5 font-medium text-red-200 hover:bg-red-800/60"
                >
                  Confirmar troca e vincular
                </button>
                <button
                  type="button"
                  onClick={() => setShowSwitchConfirm(false)}
                  className="rounded-md border border-[#444] px-3 py-1.5 text-gray-400 hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {message && <p role="status" className="text-[12px] text-emerald-400">{message}</p>}
          {error && <p role="alert" className="text-[12px] text-red-400">{error}</p>}
        </div>

        {/* Fallback nativo: braincore://device-settings */}
        <div className="flex flex-col gap-2 border-t border-[#252525] pt-3">
          <p className="text-[12px] text-gray-400">
            Ajustes nativos e alternativa quando o PC estiver offline:
          </p>
          <a
            href="braincore://device-settings"
            className="self-start rounded-lg border border-[#444] px-3 py-2 text-[13px] text-white hover:bg-white/[0.04] transition-colors"
          >
            Abrir ajustes deste aparelho
          </a>
        </div>
      </div>
    </section>
  );
}

function TranscriptionPolicySection() {
  type Mode = 'automatic' | 'scheduled' | 'manual';
  const [mode, setMode] = useState<Mode>('automatic');
  const [time, setTime] = useState('22:00');
  const [hours, setHours] = useState(8);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.getTranscriptionPolicy().then(policy => {
      setMode(policy.mode); setTime(policy.start_time);
      setHours(policy.window_hours); setRunning(Boolean(policy.manual_active)); setPaused(Boolean(policy.paused));
    }).catch(() => setMessage('Não foi possível consultar a fila de transcrição.'));
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      api.getTranscriptionPolicy().then(policy => {
        setRunning(Boolean(policy.manual_active));
        setPaused(Boolean(policy.paused));
      }).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [running]);

  const save = async () => {
    setBusy(true);
    try {
      const policy = await api.setTranscriptionPolicy({ mode, start_time: time, window_hours: hours, timezone: 'America/Sao_Paulo' });
      setRunning(Boolean(policy.manual_active));
      setPaused(Boolean(policy.paused));
      setMessage('Modo de transcrição salvo.');
    } catch { setMessage('Não foi possível salvar o modo de transcrição.'); }
    finally { setBusy(false); }
  };
  const setManual = async (active: boolean) => {
    setBusy(true);
    try {
      const policy = active ? await api.runTranscriptionNow() : await api.pauseTranscription();
      setRunning(Boolean(policy.manual_active));
      setPaused(Boolean(policy.paused));
      setMessage(active ? 'Fila liberada agora; acompanhe o progresso na Linha do Tempo.' : 'Novos jobs pausados. O bloco atual termina antes de parar.');
    } catch { setMessage('Não foi possível controlar a fila.'); }
    finally { setBusy(false); }
  };

  return <section className="flex flex-col gap-4">
    <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Transcrição na GPU</h2>
    <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5 flex flex-col gap-4 text-[13px]">
      <p className="text-gray-400">O áudio continua sendo salvo e enviado enquanto a GPU espera. O modo vale para as gravações desta conta.</p>
      <label>Quando transcrever
        <select aria-label="Modo de transcrição" value={mode} onChange={e => setMode(e.target.value as Mode)}
          className="ml-3 rounded-lg border border-[#444] bg-[#151515] px-3 py-2 text-white">
          <option value="automatic">Automaticamente</option><option value="scheduled">Em horário programado</option><option value="manual">Somente quando eu clicar</option>
        </select>
      </label>
      {mode === 'scheduled' && <div className="flex flex-wrap items-center gap-3">
        <label>Iniciar às <input aria-label="Início da transcrição" type="time" value={time} onChange={e => setTime(e.target.value)}
          className="ml-2 rounded-lg border border-[#444] bg-[#151515] px-3 py-2 text-white" /></label>
        <label>Janela <select aria-label="Duração da janela" value={hours} onChange={e => setHours(Number(e.target.value))}
          className="ml-2 rounded-lg border border-[#444] bg-[#151515] px-3 py-2 text-white">
          {[2, 4, 8, 12].map(value => <option key={value} value={value}>{value} h</option>)}
        </select></label>
        <span className="text-gray-500">Horário de Brasília</span>
      </div>}
      <button type="button" disabled={busy} onClick={() => void save()}
        className="self-start rounded-lg border border-[#444] px-3 py-2 disabled:opacity-50">Salvar modo</button>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || (running && !paused)} onClick={() => void setManual(true)}
          className="rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-50">Transcrever agora</button>
        <button type="button" disabled={busy || paused} onClick={() => void setManual(false)}
          className="rounded-lg border border-[#444] px-3 py-2 disabled:opacity-50">Pausar novos blocos</button>
      </div>
      {paused && <p className="text-[12px] text-amber-300">Fila pausada nesta conta. Use “Transcrever agora” ou salve o modo para retomar.</p>}
      <p className="text-[12px] text-gray-500">Pausar não interrompe um bloco já em processamento. O início manual termina quando a fila desta conta esvaziar.</p>
      {message && <p role="status" className="text-[12px] text-gray-300">{message}</p>}
    </div>
  </section>;
}

function TwoFactorSection({
  user,
  onUserChange,
}: {
  user: UserInfo | null;
  onUserChange: (next: UserInfo | null | ((previous: UserInfo | null) => UserInfo | null)) => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingSecret, setPendingSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const isEnabled = user?.two_factor_enabled === true;
  const hasPendingSetup = pendingSecret.length > 0;
  const hasPendingSetupPersisted = user?.two_factor_setup_pending === true;
  const isPending = !isEnabled && (hasPendingSetup || hasPendingSetupPersisted);

  useEffect(() => {
    let cancelled = false;

    if (!otpauthUri) return;

    QRCode.toDataURL(otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: {
        dark: '#111111',
        light: '#f5f5f5',
      },
    })
      .then((dataUrl: string) => {
        if (!cancelled) setQrCodeDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrCodeDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  const handleBeginSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setError('');
    try {
      const data = await api.beginTwoFactorSetup(password);
      setPendingSecret(data.secret);
      setOtpauthUri(data.otpauthUri);
      setCode('');
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar 2FA');
      setStatus('error');
    }
  };

  const handleConfirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setError('');
    try {
      await api.confirmTwoFactorSetup(code);
      setPendingSecret('');
      setOtpauthUri('');
      setQrCodeDataUrl('');
      setPassword('');
      setCode('');
      setStatus('success');
      onUserChange((previous) => previous ? { ...previous, two_factor_enabled: true, two_factor_setup_pending: false } : previous);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao confirmar 2FA');
      setStatus('error');
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setError('');
    try {
      await api.disableTwoFactor(password, code);
      setPassword('');
      setCode('');
      setStatus('success');
      onUserChange((previous) => previous ? { ...previous, two_factor_enabled: false, two_factor_setup_pending: false } : previous);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao desativar 2FA');
      setStatus('error');
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] uppercase tracking-widest text-gray-600">2FA</h2>
      <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5 flex flex-col gap-4">
        <div>
          <p className="text-[13px] text-white">Autenticação em dois fatores</p>
          <p className="text-[12px] text-gray-500 mt-1">
            {isEnabled
              ? 'Ativada. O login exige sua senha e um código temporário do autenticador.'
              : isPending
                ? 'Configuração pendente. Confirme o código do autenticador para tornar o 2FA obrigatório no login.'
                : 'Desativada. Ative para exigir um código TOTP no login.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wider ${
            isEnabled
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : isPending
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-[#2a2a2a] bg-[#151515] text-gray-400'
          }`}>
            {isEnabled ? '2FA ativo' : isPending ? 'Configuração pendente' : '2FA desativado'}
          </span>
        </div>

        {!isEnabled && !hasPendingSetup && (
          <form onSubmit={handleBeginSetup} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-gray-600 uppercase tracking-wider">Confirme sua senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#151515] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-[#444]"
                placeholder="••••••"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={status === 'loading'}
                className="px-4 py-2 text-[13px] bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'loading' ? 'Preparando…' : hasPendingSetupPersisted ? 'Continuar configuração 2FA' : 'Ativar 2FA'}
              </button>
            </div>
          </form>
        )}

        {!isEnabled && hasPendingSetup && (
          <form onSubmit={handleConfirmSetup} className="flex flex-col gap-3">
            <div className="rounded-xl border border-[#2a2a2a] bg-[#151515] p-4">
              <div className="flex flex-col items-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#101010] p-4">
                <p className="text-[12px] text-gray-400">Escaneie no Google Authenticator</p>
                {otpauthUri && qrCodeDataUrl ? (
                  <img
                    src={qrCodeDataUrl}
                    alt="QR Code do 2FA"
                    className="h-[220px] w-[220px] rounded-lg bg-[#f5f5f5] p-2"
                  />
                ) : (
                  <div className="flex h-[220px] w-[220px] items-center justify-center rounded-lg border border-dashed border-[#2a2a2a] text-[12px] text-gray-500">
                    Gerando QR Code…
                  </div>
                )}
              </div>
              <p className="text-[12px] text-gray-400">Chave manual</p>
              <p className="mt-1 break-all font-mono text-[13px] text-white">{pendingSecret}</p>
              <p className="mt-3 text-[12px] text-gray-500">
                Escaneie o QR no Google Authenticator ou adicione a chave manual e confirme com o código de 6 dígitos.
              </p>
              <p className="mt-2 break-all text-[11px] text-gray-600">{otpauthUri}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-gray-600 uppercase tracking-wider">Código do autenticador</label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                className="w-full bg-[#151515] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-[#444]"
                placeholder="000000"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setPendingSecret('');
                  setOtpauthUri('');
                  setQrCodeDataUrl('');
                  setCode('');
                  setPassword('');
                  setStatus('idle');
                  setError('');
                }}
                className="text-[13px] text-gray-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={status === 'loading'}
                className="px-4 py-2 text-[13px] bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'loading' ? 'Confirmando…' : 'Confirmar 2FA'}
              </button>
            </div>
          </form>
        )}

        {isEnabled && (
          <form onSubmit={handleDisable} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-gray-600 uppercase tracking-wider">Senha atual</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#151515] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-[#444]"
                placeholder="••••••"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-gray-600 uppercase tracking-wider">Código 2FA</label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                className="w-full bg-[#151515] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-[#444]"
                placeholder="000000"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={status === 'loading'}
                className="px-4 py-2 text-[13px] text-red-400 border border-red-900/40 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'loading' ? 'Desativando…' : 'Desativar 2FA'}
              </button>
            </div>
          </form>
        )}

        {status === 'error' && <p className="text-[12px] text-red-400">{error}</p>}
        {status === 'success' && (
          <p className="text-[12px] text-green-400">
            {isEnabled ? '2FA desativado com sucesso.' : '2FA ativado com sucesso. O próximo login já vai pedir o código.'}
          </p>
        )}
      </div>
    </section>
  );
}

function TelegramSection({ user, onUpdate }: { user: UserInfo | null; onUpdate: (next: UserInfo) => void }) {
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const [syncedUser, setSyncedUser] = useState(user);
  if (syncedUser !== user) {
    setSyncedUser(user);
    setChatId(user?.telegram_chat_id ?? '');
    setEnabled(user?.telegram_notifications_enabled === true);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setError('');
    try {
      const next = await api.updateTelegramSettings(chatId, enabled);
      onUpdate(next);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar Telegram');
      setStatus('error');
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Telegram</h2>
      <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-[13px] text-white">Lembretes das Notas via bot `@Brain_corebot`</p>
          <p className="text-[12px] text-gray-500">Abra o bot no Telegram, envie qualquer mensagem para iniciar a conversa e cole aqui o seu `chat_id`.</p>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-gray-600 uppercase tracking-wider">Telegram chat ID</label>
            <input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              className="w-full bg-[#151515] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-[#444]"
              placeholder="Ex: 123456789"
            />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-gray-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-white"
            />
            Ativar notificações de lembrete
          </label>

          {status === 'error' && <p className="text-[12px] text-red-400">{error}</p>}
          {status === 'success' && <p className="text-[12px] text-green-400">Telegram salvo com sucesso.</p>}

          <div className="flex justify-end mt-1">
            <button
              type="submit"
              disabled={status === 'loading'}
              className="px-4 py-2 text-[13px] bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'loading' ? 'Salvando…' : 'Salvar Telegram'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function MobileDevicesSection() {
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.listMobileDevices().then(data => setDevices(data.devices)).catch(() => setError('Não foi possível carregar os aparelhos.'));
  }, []);

  const revoke = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await api.revokeMobileDevice(id);
      setDevices(current => current.filter(device => device.id !== id));
    } catch {
      setError('Não foi possível revogar este aparelho.');
    } finally { setBusy(null); }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Aparelhos com gravação</h2>
      <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5 flex flex-col gap-3">
        <p className="text-[12px] text-gray-500">Revogar impede novos envios e consultas de texto. Os áudios já salvos no aparelho não são apagados.</p>
        {devices.length === 0 && <p className="text-[13px] text-gray-500">Nenhum aparelho vinculado.</p>}
        {devices.map(device => (
          <div key={device.id} className="flex items-center justify-between gap-3 border-t border-[#292929] pt-3">
            <div>
              <p className="text-[13px] text-white">{device.name}</p>
              <p className="text-[11px] text-gray-500">Vinculado em {new Date(device.created_at).toLocaleDateString('pt-BR')}</p>
            </div>
            <button type="button" disabled={busy === device.id} onClick={() => void revoke(device.id)}
              className="px-3 py-2 text-[12px] text-red-400 border border-red-900/40 rounded-lg disabled:opacity-50">
              Revogar
            </button>
          </div>
        ))}
        {error && <p className="text-[12px] text-red-400">{error}</p>}
      </div>
    </section>
  );
}

function ThemeSettingsSection() {
  const { choice, chooseTheme } = useTheme();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Aparência</h2>
      <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
        <p className="mb-3 text-[13px]" style={{ color: 'var(--theme-text)' }}>Tema do aplicativo</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {themeChoices.map(id => {
            const palette = id === 'system' ? null : themes[id];
            return (
              <button key={id} type="button" aria-pressed={choice === id}
                onClick={() => chooseTheme(id)}
                className="flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-left text-[13px]"
                style={{ borderColor: choice === id ? 'var(--theme-primary)' : 'var(--theme-border)', color: 'var(--theme-text)' }}>
                {palette ? <span className="h-6 w-6 shrink-0 rounded-full border" style={{ backgroundColor: palette.background, borderColor: palette.primary, boxShadow: `inset 0 0 0 5px ${palette.primary}` }} /> : <span aria-hidden="true">◐</span>}
                <span className="min-w-0">
                  <span className="block">{palette?.label ?? 'Seguir sistema'}</span>
                  <span className="block text-[11px]" style={{ color: 'var(--theme-muted)' }}>{palette?.context ?? 'Acompanha o modo do aparelho'}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    api.getMe().then(setUser).catch(error => {
      if (/API 401|API 403/.test(String(error))) navigate('/login', { replace: true });
      else setSessionError('Não foi possível carregar a conta. Verifique a conexão e recarregue.');
    });
  }, [navigate]);

  const handleLogout = () => {
    setSessionError('');
    void api.logout().then(() => {
      navigate('/login', { replace: true });
    }).catch(() => {
      setSessionError('Não foi possível confirmar a saída no servidor. Tente novamente.');
    });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--theme-background)', color: 'var(--theme-text)' }}>
      <div className="flex items-center justify-between px-8 py-5 border-b border-[#222]">
        <button
          className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-[13px] transition-colors"
          onClick={() => navigate('/')}
        >
          <span className="text-lg">←</span>
          Voltar
        </button>
        <div className="flex items-center gap-2">
          <img
            src={SETTINGS_ICON_URL}
            alt="Configurações"
            className="h-5 w-5 object-contain"
            draggable={false}
          />
          <span className="text-[15px] font-semibold text-white">Configurações</span>
        </div>
        <div className="w-20" />
      </div>

      <div className="flex-1 max-w-xl mx-auto w-full px-8 py-10 flex flex-col gap-8">
        {sessionError && <p role="alert" className="text-[13px] text-red-400">{sessionError}</p>}
        <ThemeSettingsSection />
        <section className="flex flex-col gap-4">
          <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Conta</h2>
          <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5 flex flex-col gap-3">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#2a2a2a] flex items-center justify-center text-lg select-none">
                  🧠
                </div>
                <div>
                  <p className="text-[14px] font-medium text-white">{user.name || 'Usuário'}</p>
                  <p className="text-[12px] text-gray-500">{user.email}</p>
                </div>
              </div>
            ) : (
              <div className="text-[13px] text-gray-600">Carregando…</div>
            )}
          </div>
        </section>

        <ContactsSection />
        <ChangePasswordSection />
        <TwoFactorSection user={user} onUserChange={setUser} />
        <MobileDevicesSection />
        <ThisDeviceSection user={user} />
        <TranscriptionPolicySection />
        <PcAudioRetentionSection />
        <TelegramSection user={user} onUpdate={setUser} />

        <section className="flex flex-col gap-4">
          <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Sessão</h2>
          <div className="bg-[#1c1c1c] border border-[#252525] rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] text-white">Sair da conta</p>
                <p className="text-[12px] text-gray-600 mt-0.5">Você precisará fazer login novamente</p>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-[13px] text-red-400 border border-red-900/40 rounded-lg hover:bg-red-500/10 transition-colors"
              >
                Sair
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
