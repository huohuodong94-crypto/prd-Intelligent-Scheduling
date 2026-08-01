import { NextResponse } from "next/server";
import type { ApiFailure, ApiSuccess } from "./contracts/api";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, { status });
}

export function fail(message: string, status = 400, details?: unknown) {
  const body: ApiFailure = { ok: false, error: message };
  if (details !== undefined) body.details = details;
  return NextResponse.json<ApiFailure>(body, { status });
}

export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
