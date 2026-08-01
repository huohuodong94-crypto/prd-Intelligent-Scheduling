import { afterEach, describe, expect, it, vi } from "vitest";

import { e2eImportFailureRow } from "./schedule-command-service";

afterEach(() => vi.unstubAllEnvs());

describe("server-only import rollback fixture", () => {
  it("stays disabled without the server flag", () => {
    expect(e2eImportFailureRow("rollback-fixture.xlsx")).toBeNull();
  });

  it("requires both the exact server flag and exact fixture filename", () => {
    vi.stubEnv("WFM_E2E_IMPORT_FAILURES", "1");
    expect(e2eImportFailureRow("rollback.xlsx")).toBeNull();
    expect(e2eImportFailureRow("ROLLBACK-FIXTURE.XLSX")).toBeNull();
    expect(e2eImportFailureRow("rollback-fixture.xlsx")).toBe(2);
  });
});
