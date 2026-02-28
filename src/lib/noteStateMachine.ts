const ALLOWED_NOTE_STATUS_TRANSITIONS: Record<string, Set<string>> = {
  draft_created: new Set(['needs_review', 'approved_for_writeback', 'blocked']),
  needs_review: new Set(['approved_for_writeback', 'blocked']),
  approved_for_writeback: new Set(['writeback_queued']),
  writeback_queued: new Set(['writeback_in_progress', 'writeback_failed']),
  writeback_in_progress: new Set(['writeback_succeeded', 'writeback_failed']),
  writeback_failed: new Set(['writeback_queued']),
  blocked: new Set([]),
  writeback_succeeded: new Set([])
};

export function canTransitionNoteStatus(from: string, to: string): boolean {
  return ALLOWED_NOTE_STATUS_TRANSITIONS[from]?.has(to) ?? false;
}
