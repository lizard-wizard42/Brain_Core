#!/usr/bin/env node
/* Create one member account after the ownership migration. Password comes from stdin. */
const readline = require('node:readline');
const bcrypt = require('bcrypt');
const { query, pool } = require('../dist/config/database');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um email válido');
  const lines = readline.createInterface({ input: process.stdin, terminal: false });
  const password = await new Promise((resolve, reject) => {
    lines.once('line', resolve);
    lines.once('close', () => reject(new Error('Senha não recebida')));
  });
  lines.close();
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('A senha deve ter pelo menos 12 caracteres, letras e números');
  }
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.length) throw new Error('Conta já existe; nenhuma alteração foi feita');
  const owners = await query("SELECT id FROM users WHERE role = 'owner'");
  if (owners.length !== 1) throw new Error('Crie a conta proprietária antes de adicionar membros');
  const hash = await bcrypt.hash(password, 12);
  const created = await query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'member') RETURNING id`,
    [email, hash],
  );
  console.log(`Conta criada: ${email}, id ${created[0].id}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());
