import { describe, expect, it } from "vitest";

import { STATUS_TAG_COLORS } from "./StatusTag";

function luminance(color: string) {
  const channels = color.slice(1).match(/../g)?.map((value) => Number.parseInt(value, 16) / 255);
  if (!channels) throw new Error(`Invalid hex color: ${color}`);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe("StatusTag", () => {
  it.each([
    "success",
    "warning",
    "danger",
  ] as const)("keeps %s text at WCAG AA contrast", (tone) => {
    const colors = STATUS_TAG_COLORS[tone];
    expect(contrastRatio(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
  });
});
