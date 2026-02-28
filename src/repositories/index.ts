import type { Pool } from 'pg';
import { createAuditRepository } from './audit.js';
import type { RepositoryBundle } from './contracts.js';
import { createFactsRepository } from './facts.js';
import { createMemoryStore } from './memoryStore.js';
import { createNotesRepository } from './notes.js';
import { createSegmentsRepository } from './segments.js';
import { createSessionsRepository } from './sessions.js';
import { createValidationRepository } from './validation.js';
import { createWritebackRepository } from './writeback.js';

export function createRepositories(pool: Pool | null): RepositoryBundle {
  const store = createMemoryStore();
  const db = pool;

  return {
    sessions: createSessionsRepository(db, store),
    segments: createSegmentsRepository(db, store),
    facts: createFactsRepository(db, store),
    notes: createNotesRepository(db, store),
    validation: createValidationRepository(db, store),
    writeback: createWritebackRepository(db, store),
    audit: createAuditRepository(db, store)
  };
}
