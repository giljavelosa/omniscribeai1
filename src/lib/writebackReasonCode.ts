export const WRITEBACK_REASON_CODE_FIELDS = ['reasonCode', 'code'] as const;

export function readWritebackReasonCode(detail?: Record<string, unknown> | null): string | null {
  if (!detail) {
    return null;
  }

  for (const key of WRITEBACK_REASON_CODE_FIELDS) {
    const candidate = detail[key];
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toUpperCase();
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return null;
}
