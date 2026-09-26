import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const requestedRoute = (location.state as { from?: unknown } | null)?.from;
  const afterLogin = typeof requestedRoute === 'string' && /^\/(?!\/)/.test(requestedRoute)
    ? requestedRoute
    : '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [pendingToken, setPendingToken] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const inTwoFactorStep = pendingToken.length > 0;

  useEffect(() => {
    api.getInitialSetupStatus()
      .then(({ setupRequired }) => {
        if (setupRequired) navigate('/setup', { replace: true });
      })
      .catch(() => undefined);
  }, [navigate]);

  const mapAuthMessage = (raw: string): { kind: 'error' | 'notice'; text: string } => {
    if (/Muitas tentativas|bloqueada|429/i.test(raw)) {
      return { kind: 'notice', text: 'CORE_LOCK_429: limite de tentativas atingido. Aguarde novo ciclo.' };
    }
    if (/Sessão de login 2FA expirada/i.test(raw)) {
      return { kind: 'error', text: 'CORE_2FA_440: sessão temporária expirada. Reinicie a autenticação.' };
    }
    if (/Código 2FA inválido/i.test(raw)) {
      return { kind: 'error', text: 'CORE_2FA_401: chave temporal inválida.' };
    }
    if (/Credenciais inválidas/i.test(raw)) {
      return { kind: 'error', text: 'CORE_AUTH_401: credencial inválida.' };
    }
    return { kind: 'error', text: 'CORE_AUTH_500: falha de autenticação.' };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inTwoFactorStep && (!email.trim() || !password)) return;
    if (inTwoFactorStep && !twoFactorCode.trim()) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      if (inTwoFactorStep) {
        await api.verifyLoginTwoFactor(pendingToken, twoFactorCode.trim(), rememberDevice);
      } else {
        const response = await api.login(email.trim(), password);
        if (response.requiresTwoFactor) {
          setPendingToken(response.pendingToken);
          setTwoFactorCode('');
          setNotice('CORE_2FA_REQUIRED: informe chave temporal de 6 dígitos.');
          setLoading(false);
          return;
        }
      }
      navigate(afterLogin, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao fazer login';
      const mapped = mapAuthMessage(message);
      setError(mapped.kind === 'error' ? mapped.text : '');
      setNotice(mapped.kind === 'notice' ? mapped.text : '');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToPassword = () => {
    setPendingToken('');
    setTwoFactorCode('');
    setError('');
    setNotice('');
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-2xl font-bold text-white tracking-tight">Brain Core</h1>
          <p className="text-sm text-gray-500 tracking-[0.18em] uppercase">Core ID</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="w-full flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-gray-500 uppercase tracking-wider">Core ID</label>
            <input
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={inTwoFactorStep}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] focus:border-[#444] rounded-xl px-4 py-3 text-[14px] text-white outline-none transition-colors placeholder-[#444]"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-gray-500 uppercase tracking-wider">{inTwoFactorStep ? 'Código de Verificação' : 'Chave de Acesso'}</label>
            <input
              type={inTwoFactorStep ? 'text' : 'password'}
              autoComplete={inTwoFactorStep ? 'one-time-code' : 'current-password'}
              inputMode={inTwoFactorStep ? 'numeric' : undefined}
              value={inTwoFactorStep ? twoFactorCode : password}
              onChange={e => inTwoFactorStep ? setTwoFactorCode(e.target.value) : setPassword(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] focus:border-[#444] rounded-xl px-4 py-3 text-[14px] text-white outline-none transition-colors placeholder-[#444]"
              required
            />
          </div>

          {error && (
            <p className="text-[13px] text-red-400 text-center">{error}</p>
          )}

          {notice && (
            <p className="text-[13px] text-amber-300 text-center">{notice}</p>
          )}

          {inTwoFactorStep && (
            <label className="flex items-center gap-2 text-[13px] text-gray-400 select-none">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="h-4 w-4 rounded border-[#3a3a3a] bg-[#1a1a1a]"
              />
              <span>Lembrar este dispositivo por 30 dias</span>
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            className="login-submit mt-1 w-full bg-white text-black font-semibold text-[14px] py-3 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Autenticando Core…' : inTwoFactorStep ? 'Validar Core' : 'Acessar Core'}
          </button>

          {inTwoFactorStep && (
            <button
              type="button"
              onClick={handleBackToPassword}
              className="w-full text-[13px] text-gray-400 hover:text-white transition-colors"
            >
              Retornar ao Core ID
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
