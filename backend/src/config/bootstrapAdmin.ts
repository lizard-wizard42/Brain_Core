import bcrypt from 'bcrypt';
import { config } from './index';
import { query } from './database';

export async function ensureInitialAdmin(): Promise<void> {
  const email = config.INITIAL_ADMIN_EMAIL.toLowerCase();
  const password = config.INITIAL_ADMIN_PASSWORD;

  if (!email && !password) return;
  if (!email || !password) {
    throw new Error('INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD devem ser definidos juntos.');
  }
  if (password.length < config.PASSWORD_MIN_LENGTH || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error(`INITIAL_ADMIN_PASSWORD deve ter ao menos ${config.PASSWORD_MIN_LENGTH} caracteres, letras e números.`);
  }

  const existing = await query<{ id: string }>('SELECT id FROM users LIMIT 1');
  if (existing.length) return;

  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, 'owner')`,
    [email, passwordHash, config.INITIAL_ADMIN_NAME || null],
  );
}
