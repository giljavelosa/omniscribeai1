import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrator.js';

async function main() {
  const result = await runMigrations();
  if (!result.ran) {
    console.log('No DATABASE_URL configured; skipping migrations.');
    return;
  }

  if (result.applied.length === 0) {
    console.log('No new migrations.');
    return;
  }

  console.log(`Applied migrations: ${result.applied.join(', ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
