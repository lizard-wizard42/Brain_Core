import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api/client';
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

    if (!otpauthUri) {
      setQrCodeDataUrl('');
      return;
    }

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
                {qrCodeDataUrl ? (
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

  useEffect(() => {
    setChatId(user?.telegram_chat_id ?? '');
    setEnabled(user?.telegram_notifications_enabled === true);
  }, [user]);

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
          <p className="text-[13px] text-white">Lembretes das Notas via bot configurado</p>
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

export function SettingsPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    api.getMe().then(setUser).catch(() => {
      void api.logout().finally(() => {
        navigate('/login', { replace: true });
      });
    });
  }, [navigate]);

  const handleLogout = () => {
    void api.logout().finally(() => {
      navigate('/login', { replace: true });
    });
  };

  return (
    <div className="min-h-screen bg-[#191919] flex flex-col">
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

        <ChangePasswordSection />
        <TwoFactorSection user={user} onUserChange={setUser} />
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
