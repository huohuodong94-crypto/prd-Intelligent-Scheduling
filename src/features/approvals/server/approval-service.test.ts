import { describe, expect, it, vi } from "vitest";

import {
  normalizeAiAdvice,
  normalizeDecision,
  normalizeManagerStatus,
  requestAiAdvice,
} from "./approval-service";

describe("unified approval service contracts", () => {
  it("requires a rejection reason", () => {
    expect(() =>
      normalizeDecision({
        items: [{ id: "a", type: "leave" }],
        decision: "rejected",
        reason: null,
        aiLogIds: [],
      }),
    ).toThrow("驳回原因不能为空");
  });

  it("deduplicates by type:id without collapsing different types", () => {
    const result = normalizeDecision({
      items: [
        { id: "same", type: "leave" },
        { id: "same", type: "leave" },
        { id: "same", type: "punch_correction" },
      ],
      decision: "approved",
      reason: null,
      aiLogIds: [],
    });

    expect(result.items).toEqual([
      { id: "same", type: "leave" },
      { id: "same", type: "punch_correction" },
    ]);
  });

  it("excludes target-pending swaps from the manager pending queue", () => {
    expect(normalizeManagerStatus("leave", "pending")).toBe("pending");
    expect(normalizeManagerStatus("shift_swap", "pending_manager")).toBe("pending");
    expect(normalizeManagerStatus("shift_swap", "pending_target")).toBeNull();
  });

  it("falls back to suspicious for invalid model output", () => {
    expect(normalizeAiAdvice("not-json")).toEqual({
      suggestion: "suspicious",
      reason: expect.any(String),
    });
  });

  it("AI advice never invokes the manual decision callback", async () => {
    const decide = vi.fn();
    const advice = await requestAiAdvice({
      generate: vi.fn().mockResolvedValue('{"suggestion":"compliant","reason":"规则满足"}'),
      decide,
      prompt: "check",
    });

    expect(advice.suggestion).toBe("compliant");
    expect(decide).not.toHaveBeenCalled();
  });
});
