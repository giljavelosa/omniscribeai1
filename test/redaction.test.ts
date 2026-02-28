import { describe, expect, it } from 'vitest';
import { redactSensitive } from '../src/lib/redaction.js';

describe('redactSensitive', () => {
  it('redacts auth and PHI-like keys recursively', () => {
    const input = {
      headers: {
        authorization: 'Bearer token-123',
        'x-api-key': 'api-key-123',
        accept: 'application/json'
      },
      patient: {
        fullName: 'Jane Doe',
        dob: '1990-01-01',
        mrn: 'MRN-001',
        notes: 'left knee pain'
      },
      entries: [{ email: 'jane@example.com' }, { status: 'ok' }]
    };

    const output = redactSensitive(input);

    expect(output.headers.authorization).toBe('[REDACTED]');
    expect(output.headers['x-api-key']).toBe('[REDACTED]');
    expect(output.headers.accept).toBe('application/json');
    expect(output.patient).toBe('[REDACTED]');
    expect(output.entries[0].email).toBe('[REDACTED]');
    expect(output.entries[1].status).toBe('ok');
  });

  it('does not mutate the original object', () => {
    const input = {
      password: 'super-secret',
      nested: { keep: 'value' }
    };

    const output = redactSensitive(input);

    expect(output.password).toBe('[REDACTED]');
    expect(input.password).toBe('super-secret');
    expect(output.nested.keep).toBe('value');
  });
});
