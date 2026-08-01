import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_MS = 60_000;

function codeForWindow(storeId: string, window: number, secret: string): string {
  const digest = createHmac("sha256", secret).update(`${storeId}:${window}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function createClockCode(storeId: string, now: Date, secret: string) {
  const window = Math.floor(now.getTime() / WINDOW_MS);
  return {
    code: codeForWindow(storeId, window, secret),
    window,
    refreshAt: new Date((window + 1) * WINDOW_MS).toISOString(),
    expiresAt: new Date((window + 2) * WINDOW_MS).toISOString(),
  };
}

export function verifyClockCode(
  storeId: string,
  code: string,
  now: Date,
  secret: string,
): { matchedWindow: number } | null {
  if (!/^\d{6}$/.test(code)) return null;
  const window = Math.floor(now.getTime() / WINDOW_MS);
  const actual = Buffer.from(code, "utf8");
  for (const candidate of [window, window - 1]) {
    const expected = Buffer.from(codeForWindow(storeId, candidate, secret), "utf8");
    if (timingSafeEqual(expected, actual)) return { matchedWindow: candidate };
  }
  return null;
}
