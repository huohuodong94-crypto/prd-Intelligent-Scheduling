import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import MySchedulePage from "./MySchedulePage";

it("renders the employee published rows and weekly hours read-only", () => {
  render(
    <MySchedulePage
      weekOf="2026-07-20"
      rows={[{ date: "2026-07-20", shiftType: "morning", hours: 4 }]}
      totalHours={4}
    />,
  );

  expect(screen.getByText("早班 09:00–13:00")).toBeInTheDocument();
  expect(screen.getByText("本周 4 小时")).toBeInTheDocument();
});
