import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export function SetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    api.getInitialSetupStatus()
      .then(({ setupRequired }) => {
        if (active && !setupRequired) navigate('/login', { replace: true });
      })
      .catch(() => active && setError('Não foi possível verificar a configuração inicial.'))
      .finally(() => active && setChecking(false));
    return () => { active = false; };
  }, [navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== passwordConfirmation) {
      setError('As senhas precisam ser iguais.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.completeInitialSetup(name.trim(), email.trim(), password);
      navigate('/', { replace: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível concluir a configuração inicial.';
      setError(message);
      if (/já foi concluída/i.test(message)) navigate('/login', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center text-sm text-gray-400">Preparando o Brain Core…</div>;
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#151515] p-7 shadow-2xl">
        <div className="mb-7">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-gray-500">Primeiro acesso</p>
          <h1 className="text-2xl font-bold tracking-tight text-white">Bem-vindo ao Brain Core</h1>
          <p className="mt-2 text-sm leading-6 text-gray-400">Crie a conta de administrador desta instalação local. Este formulário desaparece assim que a conta for criada.</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5 text-[12px] uppercase tracking-wider text-gray-500">
            Nome
            <input className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-sm normal-case tracking-normal text-white outline-none transition-colors focus:border-[#555]" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" autoFocus required maxLength={120} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] uppercase tracking-wider text-gray-500">
            E-mail
            <input className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-sm normal-case tracking-normal text-white outline-none transition-colors focus:border-[#555]" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] uppercase tracking-wider text-gray-500">
            Senha
            <input className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-sm normal-case tracking-normal text-white outline-none transition-colors focus:border-[#555]" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={12} />
            <span className="normal-case tracking-normal text-xs text-gray-600">Use pelo menos 12 caracteres, com letras e números.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] uppercase tracking-wider text-gray-500">
            Confirmar senha
            <input className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-sm normal-case tracking-normal text-white outline-none transition-colors focus:border-[#555]" type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" required />
          </label>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="mt-2 rounded-xl bg-white py-3 text-sm font-semibold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? 'Criando conta…' : 'Criar conta e abrir o Brain Core'}
          </button>
        </form>
      </div>
    </div>
  );
}
