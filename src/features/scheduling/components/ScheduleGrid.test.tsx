import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import ScheduleGrid from "./ScheduleGrid";

it("revalidates a copied cell before pasting inside the plan week", async () => {
  const onChange = vi.fn();
  const validateCell = vi.fn().mockReturnValue([]);
  render(
    <ScheduleGrid
      planId="plan-1"
      weekOf="2026-07-20"
      version={0}
      employees={[{ id: "employee-1", name: "小王", position: "sales" }]}
      days={["2026-07-20", "2026-07-21"]}
      cells={[{ userId: "employee-1", date: "2026-07-20", shifts: ["morning"] }]}
      issues={[]}
      onChange={onChange}
      validateCell={validateCell}
    />,
  );

  await userEvent.pointer({ target: screen.getByTestId("cell-employee-1-2026-07-20"), keys: "[MouseRight]" });
  await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
  await userEvent.pointer({ target: screen.getByTestId("cell-employee-1-2026-07-21"), keys: "[MouseRight]" });
  await userEvent.click(screen.getByRole("menuitem", { name: "粘贴" }));

  expect(validateCell).toHaveBeenCalledWith({
    userId: "employee-1",
    date: "2026-07-21",
    shifts: ["morning"],
  });
  expect(onChange).toHaveBeenCalled();
});
