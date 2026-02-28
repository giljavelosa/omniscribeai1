const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'proxyauthorization',
  'apikey',
  'secret',
  'password',
  'token',
  'cookie',
  'ssn',
  'dob',
  'birthdate',
  'patient',
  'firstname',
  'lastname',
  'fullname',
  'email',
  'phone',
  'address',
  'mrn',
  'medicalrecordnumber'
];

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const isSensitiveKey = (key: string) => {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
};

const redactRecursive = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactRecursive(item, seen));
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return REDACTED;
  }
  seen.add(value);

  const out: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    out[key] = isSensitiveKey(key)
      ? REDACTED
      : redactRecursive(childValue, seen);
  }
  return out;
};

export function redactSensitive<T>(value: T): T {
  return redactRecursive(value, new WeakSet<object>()) as T;
}

