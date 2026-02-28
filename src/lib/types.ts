export type ApiEnvelope<T> = {
  ok: boolean;
  data: T;
  correlationId?: string;
};
