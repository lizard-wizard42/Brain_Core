import { useEffect, useState } from 'react';
import { mcpApi, type McpSettings } from '../../api/client';

type Access = 'off' | 'read' | 'write';
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-transparent';
const buttonClass = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-40';
const operationLabels: Record<string, string> = { create: 'Criação', update: 'Edição', restore: 'Restauração' };
const date = (value: string) => new Date(value).toLocaleString('pt-BR');

export function McpSettingsSection() {
  const [settings, setSettings] = useState<McpSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('Agente local');
  const [pages, setPages] = useState<Access>('read');
  const [notes, setNotes] = useState<Access>('read');
  const [days, setDays] = useState(30);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [scriptPath, setScriptPath] = useState('/opt/brain-core/mcp/src/server.mjs');
  const [tokenPath, setTokenPath] = useState('/private/directory/brain-core-token.txt');
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:3001');

  useEffect(() => {
    let active = true;
    const clearSecret = () => setSecret(null);
    window.addEventListener('pagehide', clearSecret);
    mcpApi.get().then(value => { if (active) {
      setSettings(value);
      if (value.connection) { setScriptPath(value.connection.server_path); setBackendUrl(value.connection.backend_url); }
    } })
      .catch(() => { if (active) setError('Não foi possível carregar o MCP. Tente novamente.'); });
    return () => { active = false; window.removeEventListener('pagehide', clearSecret); };
  }, []);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setSettings(await mcpApi.get()); setMessage(success); }
    catch { setError('Não foi possível concluir a alteração. Atualize o status e tente novamente.'); }
    finally { setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage('Copiado.'); }
    catch { setError('Não foi possível copiar. Selecione o texto e copie manualmente.'); }
  }
  const scopes = [['pages', pages], ['notes', notes]].flatMap(([kind, access]) =>
    access === 'off' ? [] : [`${kind}:read`, ...(access === 'write' ? [`${kind}:write`] : [])]);
  const configuration = JSON.stringify({ mcpServers: { 'brain-core': { command: 'node', args: [scriptPath],
    env: { BRAIN_CORE_URL: backendUrl, BRAIN_CORE_TOKEN_FILE: tokenPath } } } }, null, 2);

  return <section className="flex flex-col gap-4" aria-labelledby="mcp-heading">
    <h2 id="mcp-heading" className="text-[11px] uppercase tracking-widest text-gray-500">MCP e acesso da IA</h2>
    <div className="rounded-2xl border p-5 flex flex-col gap-4" style={{ background: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{settings ? settings.enabled ? 'MCP ligado' : 'MCP desligado' : 'Carregando MCP…'}</p>
          <p className="text-xs text-gray-500 mt-1">Ao desligar, todas as credenciais desta conta ficam bloqueadas. Ao ligar novamente, as credenciais válidas voltam a funcionar.</p>
        </div>
        <button type="button" role="switch" aria-label="Permitir acesso pelo MCP" aria-checked={settings?.enabled ?? false}
          disabled={busy || !settings} className={buttonClass}
          onClick={() => void run(async () => { setSecret(null); await mcpApi.setEnabled(!settings!.enabled); }, settings?.enabled ? 'MCP desligado.' : 'MCP ligado.')}>
          {settings?.enabled ? 'Desligar' : 'Ligar'}
        </button>
      </div>
      <p className="text-xs text-gray-500">Esta integração permite consultar e editar suas notas. Fotos, arquivos, áudios, transcrições e terminal não têm ferramentas de acesso. Links de anexos já presentes nas notas podem aparecer no texto.</p>
      <p className="text-xs text-gray-500">A conexão MCP funciona neste computador. O cliente de IA pode enviar os textos recebidos ao provedor que você configurou.</p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {message && <p role="status" className="text-sm text-green-500">{message}</p>}
      <button type="button" disabled={busy} className={`${buttonClass} self-start`}
        onClick={() => void run(async () => {}, 'Status atualizado.')}>Atualizar status</button>

      <form className="flex flex-col gap-3 border-t pt-4" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          setSecret(null);
          const result = await mcpApi.createCredential(name.trim(), scopes, days);
          setSecret(result.secret);
        }, 'Credencial criada. Guarde-a antes de sair desta tela.');
      }}>
        <h3 className="text-sm font-medium">Nova credencial</h3>
        <label className="text-xs">Nome do cliente de IA
          <input className={`${inputClass} mt-1`} value={name} maxLength={80} required onChange={e => setName(e.target.value)} />
        </label>
        {([['Páginas de notas', pages, setPages], ['Notas rápidas', notes, setNotes]] as const).map(([label, access, setter]) =>
          <label key={label} className="text-xs">{label}
            <select className={`${inputClass} mt-1`} value={access} onChange={e => setter(e.target.value as Access)}>
              <option value="off">Sem acesso</option><option value="read">Somente leitura</option><option value="write">Leitura e edição</option>
            </select>
          </label>)}
        <label className="text-xs">Validade da credencial
          <select className={`${inputClass} mt-1`} value={days} onChange={e => setDays(Number(e.target.value))}>
            {[1, 7, 30, 90].map(n => <option key={n} value={n}>{n} {n === 1 ? 'dia' : 'dias'}</option>)}
          </select>
        </label>
        <button className={`${buttonClass} self-start`} disabled={busy || !settings?.enabled || !name.trim() || !scopes.length}>Criar credencial</button>
        {!settings?.enabled && <p className="text-xs text-gray-500">Ligue o MCP para criar uma credencial.</p>}
      </form>

      {secret && <div className="rounded-lg border p-3 flex flex-col gap-2">
        <p className="text-sm font-medium">Credencial exibida uma única vez</p>
        <p className="text-xs text-gray-500">Salve em um arquivo privado no computador. Não cole o segredo na conversa com a IA. Depois de fechar, ele não poderá ser consultado novamente.</p>
        <textarea aria-label="Nova credencial MCP" autoComplete="off" readOnly value={secret} spellCheck={false} className={`${inputClass} font-mono break-all`} />
        <div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => void copy(secret)}>Copiar credencial</button>
          <button type="button" className={buttonClass} onClick={() => setSecret(null)}>Fechar credencial</button></div>
      </div>}

      <div className="border-t pt-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium">Credenciais desta conta</h3>
        {settings?.tokens.length === 0 && <p className="text-xs text-gray-500">Nenhuma credencial criada.</p>}
        {settings?.tokens.map(token => <div key={token.id} className="rounded-lg border p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium break-words">{token.name}</span>
            <span className="text-xs">{token.revoked_at ? 'Revogada' : !token.valid ? 'Expirada ou invalidada' : settings.enabled ? 'Ativa' : 'Bloqueada pelo desligamento'}</span>
          </div>
          <p className="text-xs text-gray-500">Validade: {date(token.expires_at)}</p>
          <p className="text-xs text-gray-500">{[['pages', 'Páginas'], ['notes', 'Notas rápidas']].map(([kind, label]) =>
            `${label}: ${token.scopes.includes(`${kind}:write`) ? 'leitura e edição' : token.scopes.includes(`${kind}:read`) ? 'leitura' : 'sem acesso'}`).join(' · ')}</p>
          {!token.revoked_at && <button type="button" disabled={busy} className={`${buttonClass} self-start`} aria-label={`Revogar ${token.name}`}
            onClick={() => void run(async () => { setSecret(null); await mcpApi.revokeCredential(token.id); }, 'Credencial revogada.')}>Revogar credencial</button>}
        </div>)}
        {settings?.tokens.some(t => !t.revoked_at) && (confirmAll ? <div className="flex flex-col gap-2">
          <p className="text-xs">Revogar todas exige criar novas credenciais para reconectar os clientes.</p>
          <div className="flex gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => {
            setSecret(null); await mcpApi.revokeAll(); setConfirmAll(false);
          }, 'Todas as credenciais foram revogadas.')}>Confirmar revogação de todas</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirmAll(false)}>Cancelar</button></div>
        </div> : <button type="button" disabled={busy} className={`${buttonClass} self-start`} onClick={() => setConfirmAll(true)}>Revogar todas as credenciais</button>)}
        <p className="text-xs text-gray-500">Para renovar ou mudar permissões, crie outra credencial, atualize o cliente e revogue a anterior. Trocar a senha também invalida as credenciais.</p>
      </div>

      <details className="border-t pt-4">
        <summary className="cursor-pointer text-sm font-medium">Conectar um cliente de IA</summary>
        <div className="flex flex-col gap-3 mt-3">
          <p className="text-xs text-gray-500">Configure o cliente no mesmo computador do Brain Core. Confira os caminhos neste computador e informe o arquivo privado onde salvou a credencial. Em Docker, use o adaptador do checkout no host e o endereço HTTP publicado, normalmente http://127.0.0.1:8080; os caminhos internos do contêiner não servem ao cliente no host. O adaptador requer Node.js 20 ou superior e as dependências do diretório mcp instaladas.</p>
          <label className="text-xs">Arquivo do servidor MCP<input className={`${inputClass} mt-1`} value={scriptPath} onChange={e => setScriptPath(e.target.value)} /></label>
          <label className="text-xs">Arquivo privado da credencial<input className={`${inputClass} mt-1`} value={tokenPath} onChange={e => setTokenPath(e.target.value)} /></label>
          <label className="text-xs">Endereço local do backend<input className={`${inputClass} mt-1`} value={backendUrl} onChange={e => setBackendUrl(e.target.value)} /></label>
          <p className="text-xs text-gray-500">O arquivo da credencial deve ter permissão 0600 e pertencer ao usuário que inicia o cliente. Use uma pasta privada com permissão 0700. O endereço deve ser HTTP em 127.0.0.1 ou ::1.</p>
          <textarea aria-label="Configuração do cliente MCP" readOnly value={configuration} spellCheck={false} rows={12} className={`${inputClass} font-mono text-xs`} />
          <button type="button" className={`${buttonClass} self-start`} onClick={() => void copy(configuration)}>Copiar configuração</button>
          <p className="text-xs text-gray-500">Esta configuração contém somente caminhos. O segredo permanece no arquivo privado.</p>
        </div>
      </details>
      <details className="border-t pt-4">
        <summary className="cursor-pointer text-sm font-medium">Últimas alterações feitas pela IA</summary>
        <p className="text-xs text-gray-500 mt-2">Até 30 alterações recentes. Leituras não aparecem aqui. Recuperações ficam no histórico da nota.</p>
        {settings?.audit.length === 0 && <p className="text-xs text-gray-500 mt-2">Nenhuma alteração registrada.</p>}
        <ul className="text-xs flex flex-col gap-2 mt-3">{settings?.audit.map(item => <li key={item.id} className="rounded-lg border p-3">
          {operationLabels[item.operation] ?? item.operation} · {item.target_kind === 'pages' ? 'Página de nota' : 'Nota rápida'} · {item.credential_name ?? 'Credencial removida'}
          <br />{date(item.created_at)}<br /><span className="font-mono break-all">{item.target_id}</span>
        </li>)}</ul>
      </details>
    </div>
  </section>;
}
