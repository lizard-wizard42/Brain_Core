import { Pool } from 'pg';
import { config } from './index';

export const pool = new Pool(config.DB);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}
