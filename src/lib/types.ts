export type ApiEnvelope<T> = {
  ok: boolean;
  data: T;
  correlationId?: string;
};

export type ApiErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  correlationId: string;
};
