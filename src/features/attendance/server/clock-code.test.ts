import { describe, expect, it } from "vitest";
import { createClockCode, verifyClockCode } from "./clock-code";

describe("clock code", () => {
  const secret = "test-only-secret-never-log";

  it("returns a deterministic six digit code with refresh and final expiry", () => {
    const result = createClockCode("store-a", new Date("2026-07-19T09:00:30+08:00"), secret);
    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.refreshAt).toBe("2026-07-19T01:01:00.000Z");
    expect(result.expiresAt).toBe("2026-07-19T01:02:00.000Z");
    expect(createClockCode("store-a", new Date("2026-07-19T09:00:59+08:00"), secret).code).toBe(result.code);
  });

  it("accepts current and previous windows, exposes the matched window, and rejects older", () => {
    const now = new Date("2026-07-19T09:00:30+08:00");
    const current = createClockCode("store-a", now, secret);
    const previous = createClockCode("store-a", new Date("2026-07-19T08:59:30+08:00"), secret);
    const old = createClockCode("store-a", new Date("2026-07-19T08:58:30+08:00"), secret);
    expect(verifyClockCode("store-a", current.code, now, secret)).toEqual({ matchedWindow: current.window });
    expect(verifyClockCode("store-a", previous.code, now, secret)).toEqual({ matchedWindow: previous.window });
    expect(verifyClockCode("store-a", old.code, now, secret)).toBeNull();
  });

  it("rejects malformed and cross-store codes without throwing or leaking the secret", () => {
    const now = new Date("2026-07-19T09:00:30+08:00");
    const code = createClockCode("store-a", now, secret).code;
    for (const invalid of ["", "12345", "1234567", "abcdef"]) {
      expect(() => verifyClockCode("store-a", invalid, now, secret)).not.toThrow();
      expect(verifyClockCode("store-a", invalid, now, secret)).toBeNull();
    }
    expect(verifyClockCode("store-b", code, now, secret)).toBeNull();
    expect(verifyClockCode("store-a", code, now, "wrong-secret")).toBeNull();
    expect(JSON.stringify(createClockCode("store-a", now, secret))).not.toContain(secret);
  });
});
