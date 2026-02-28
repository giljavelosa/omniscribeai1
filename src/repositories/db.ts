import type { Pool } from 'pg';

export type DbExecutor = Pick<Pool, 'query'>;

export function mapTimestamps<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) {
      (out as Record<string, unknown>)[key] = value.toISOString();
    }
  }
  return out;
}
