import { Pool, types } from 'pg';
import { config } from './index';

// BIGINT (int8, OID 20) arrives as string by default; page revisions are
// serialized as numbers so the REST/socket contract stays `revision: number`.
types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
});

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
