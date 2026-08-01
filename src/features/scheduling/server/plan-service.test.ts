import { describe, expect, it } from "vitest";

import { normalizePlanWeek } from "./plan-service";

describe("normalizePlanWeek", () => {
  it("accepts only a Monday", () => {
    expect(normalizePlanWeek("2026-07-20")).toBe("2026-07-20");
    expect(() => normalizePlanWeek("2026-07-21")).toThrow(
      "排班计划必须从周一开始",
    );
  });
});
