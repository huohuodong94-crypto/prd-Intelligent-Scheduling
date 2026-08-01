export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: string; details?: unknown };
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
