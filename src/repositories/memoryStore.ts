import type {
  AuditEvent,
  ComposedNote,
  EncounterSession,
  FactLedgerEntry,
  TranscriptSegment,
  ValidationResult,
  WritebackJob
} from './contracts.js';

export type MemoryStore = {
  sessions: Map<string, EncounterSession>;
  segments: Map<string, Map<string, TranscriptSegment>>;
  facts: Map<string, FactLedgerEntry>;
  notes: Map<string, ComposedNote>;
  validation: Map<string, ValidationResult>;
  writeback: Map<string, WritebackJob>;
  audit: Map<string, AuditEvent>;
  factExtractionQueue: Set<string>;
};

export function createMemoryStore(): MemoryStore {
  return {
    sessions: new Map(),
    segments: new Map(),
    facts: new Map(),
    notes: new Map(),
    validation: new Map(),
    writeback: new Map(),
    audit: new Map(),
    factExtractionQueue: new Set()
  };
}
