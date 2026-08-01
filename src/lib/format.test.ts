import { describe, expect, it } from "vitest";

import { formatHours } from "./format";

describe("formatHours", () => {
  it.each([
    [1.005, "1.01 h"],
    [1.015, "1.02 h"],
    [-0, "0 h"],
    [-0.004, "0 h"],
    [1234, "1234 h"],
    [3.6666666666666665, "3.67 h"],
  ])("formats %s with decimal rounding and at most two digits", (value, expected) => {
    expect(formatHours(value)).toBe(expected);
  });
});
