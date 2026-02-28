import { Pool } from 'pg';
import { env } from '../config/env.js';

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = new Pool({ connectionString: env.DATABASE_URL });
  }

  return pool;
}

export async function closePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
