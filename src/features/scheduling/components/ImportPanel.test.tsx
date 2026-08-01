import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import ImportPanel from "./ImportPanel";

it("keeps commit disabled while validation has errors", () => {
  render(
    <ImportPanel
      planId="plan-1"
      version={0}
      validation={{
        batchId: "batch-1",
        importable: 0,
        warnings: [],
        errors: [{ severity: "error", row: 2, column: "2026-07-20", value: "通宵班", code: "invalid_shift", suggestion: "修正班次" }],
      }}
      onValidated={vi.fn()}
      onCommitted={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();
  expect(screen.getByText("修正班次")).toBeInTheDocument();
});
