#!/usr/bin/env node
// Run from backend/. The secret is written only to an exclusive private file.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { query, pool } = require('../dist/config/database');

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'list') {
    const rows = await query(`SELECT id, name, scopes, expires_at, revoked_at FROM integration_tokens ORDER BY created_at DESC`);
    console.log(JSON.stringify(rows, null, 2)); return;
  }
  if (action === 'revoke') {
    if (args.length !== 1 || !/^[0-9a-f-]{36}$/i.test(args[0])) throw new Error('Use revoke TOKEN_ID');
    const rows = await query('UPDATE integration_tokens SET revoked_at = NOW() WHERE id = $1 RETURNING id', [args[0]]);
    if (!rows.length) throw new Error('Token não encontrado');
    console.log('Credencial revogada'); return;
  }
  if (action !== 'create' || args.length !== 4) {
    throw new Error('Use create USER_ID NAME read|write /private/path/token.txt, list, ou revoke TOKEN_ID');
  }
  const [userId, name, access, output] = args;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !name.trim() || name.length > 80 || !['read', 'write'].includes(access) || !path.isAbsolute(output)) {
    throw new Error('Parâmetros inválidos');
  }
  const parent = fs.statSync(path.dirname(output));
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077)) throw new Error('Diretório de destino deve pertencer a você e ter modo 0700');
  const users = await query('SELECT session_version FROM users WHERE id = $1', [userId]);
  if (!users.length) throw new Error('Conta não encontrada');
  const token = `bc_${randomBytes(32).toString('base64url')}`;
  const scopes = ['pages:read', 'notes:read', ...(access === 'write' ? ['pages:write', 'notes:write'] : [])];
  const fd = fs.openSync(output, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${token}\n`);
    fs.fsyncSync(fd);
    const rows = await query(`INSERT INTO integration_tokens (user_id,name,token_hash,session_version,scopes,expires_at)
      VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL '30 days') RETURNING id, expires_at`,
    [userId, name.trim(), createHash('sha256').update(token).digest('hex'), users[0].session_version, scopes]);
    console.log(JSON.stringify({ id: rows[0].id, expires_at: rows[0].expires_at, scopes, credentialFile: output }));
  } catch (error) { fs.unlinkSync(output); throw error; }
  finally { fs.closeSync(fd); }
}
main().catch(() => { console.error('Falha ao gerenciar credencial. Verifique parâmetros, permissões e conexão com o banco.'); process.exitCode = 1; })
  .finally(() => pool.end());
