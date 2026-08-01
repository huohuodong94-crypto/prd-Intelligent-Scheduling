import { describe, expect, it } from "vitest";

import {
  DEFAULT_E2E_DATABASE_URL,
  resolveE2eDatabaseUrl,
} from "./playwright.environment";

describe("resolveE2eDatabaseUrl", () => {
  it("ignores DATABASE_URL and uses the dedicated safe default", () => {
    expect(resolveE2eDatabaseUrl({ DATABASE_URL: "postgresql://production.example/wfm" })).toBe(
      DEFAULT_E2E_DATABASE_URL,
    );
  });

  it("accepts an absolute SQLite .db file below /private/tmp", () => {
    expect(
      resolveE2eDatabaseUrl({ WFM_E2E_DATABASE_URL: "file:/private/tmp/wfm-custom-e2e.db" }),
    ).toBe("file:/private/tmp/wfm-custom-e2e.db");
  });

  it.each([
    "postgresql://production.example/wfm",
    "file:./relative.db",
    "file:/private/tmp/../production.db",
    "file:/Users/xanthe/wfm.db",
    "file:/private/tmp/wfm.sqlite",
    "file:/private/tmp/wfm.db?mode=ro",
  ])("rejects unsafe dedicated database URL %s", (databaseUrl) => {
    expect(() => resolveE2eDatabaseUrl({ WFM_E2E_DATABASE_URL: databaseUrl })).toThrow(
      /WFM_E2E_DATABASE_URL/,
    );
  });
});
