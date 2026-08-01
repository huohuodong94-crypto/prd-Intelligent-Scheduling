import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import ScheduleWizardPage from "./ScheduleWizardPage";
import GenerateStep from "./GenerateStep";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function detailResponse(
  assignments: Array<{ shiftType: string }> = [],
  schedules: Array<{ shiftType: "morning" | "afternoon" | "evening" }> = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    ok: true,
    data: {
      id: "p1",
      storeId: "s1",
      weekOf: "2026-07-20",
      mode: "work5rest2",
      status: "recommended",
      version: 1,
      publishedAt: null,
      plan: { id: "p1", version: 1 },
      days: ["2026-07-20"],
      operatingDays: [
        { dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "21:00" },
      ],
      employees: [
        {
          id: "e1",
          name: "小王",
          storeId: "s1",
          role: "employee",
          position: "sales",
          maxWeeklyHours: 40,
          memberships: [{
            effectiveFrom: "2026-01-01",
            effectiveTo: null,
            workGroupActive: true,
            workAreaActive: true,
          }],
        },
      ],
      approvedLeaves: [],
      unavailable: [],
      requiredByPosition: {},
      schedules: schedules.map((assignment) => ({
        userId: "e1",
        date: "2026-07-20",
        shiftType: assignment.shiftType,
        source: "manual",
      })),
      recommendation: {
        assignments: assignments.map((assignment) => ({
          userId: "e1",
          userName: "小王",
          date: "2026-07-20",
          shiftType: assignment.shiftType,
        })),
        gaps: [],
        note: "",
        explanation: "",
        status: "feasible",
      },
      ...overrides,
    },
  };
}

it("locks staffing as read-only and points correction back to forecast", () => {
  render(
    <ScheduleWizardPage
      planId="p1"
      readOnly={false}
      initialData={{
        plan: {
          id: "p1",
          storeId: "s1",
          weekOf: "2026-07-20",
          mode: "work5rest2",
          status: "draft",
          version: 0,
          publishedAt: null,
        },
        activeStep: 2,
      }}
    />,
  );

  expect(screen.getByText("人力预测")).toBeInTheDocument();
  expect(screen.queryByRole("spinbutton", { name: /人力/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回业务预测调整" })).toBeInTheDocument();
});

it("shows every legal shift for one employee on the same date", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify(detailResponse([{ shiftType: "morning" }, { shiftType: "evening" }])),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );

  render(<GenerateStep planId="p1" readOnly={false} onPrev={() => undefined} />);

  expect(await screen.findByText("早班")).toBeInTheDocument();
  expect(screen.getByText("晚班")).toBeInTheDocument();
});

it("uses a provider-neutral title for schedule generation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(detailResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

  render(<GenerateStep planId="p1" readOnly={false} onPrev={() => undefined} />);

  expect(await screen.findByText("智能排班", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText(/OR-Tools/)).not.toBeInTheDocument();
});

it("uses ScheduleGrid as the only editor after a 503 and saves a real draft", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(detailResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "优化引擎不可用，可继续手动排班" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: { saved: 1, plan: { version: 2 } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<GenerateStep planId="p1" readOnly={false} onPrev={() => undefined} />);
  await screen.findByRole("button", { name: "生成推荐" });

  await user.click(screen.getByRole("button", { name: "生成推荐" }));
  expect(await screen.findByText("优化引擎不可用，可继续手动排班")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "继续手动排班" }));
  await user.click(screen.getByTestId("cell-e1-2026-07-20"));
  await user.click(screen.getByRole("checkbox", { name: "早班" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  await user.click(screen.getByRole("button", { name: "保存草稿" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/schedule/save",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          planId: "p1",
          version: 1,
          weekOf: "2026-07-20",
          assignments: [
            { userId: "e1", date: "2026-07-20", shiftType: "morning" },
          ],
          source: "manual",
        }),
      }),
    );
  });
});

it("allows the first valid manual cell after a 503 while showing a remote staffing gap", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(detailResponse([], [], {
        days: ["2026-07-20", "2026-07-21"],
        operatingDays: [
          { dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "21:00" },
          { dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "21:00" },
        ],
        requiredByPosition: {
          "2026-07-21": { evening: { sales: 1 } },
        },
      })), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "优化引擎不可用，可继续手动排班" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<GenerateStep planId="p1" readOnly={false} onPrev={() => undefined} />);

  await user.click(await screen.findByRole("button", { name: "生成推荐" }));
  await user.click(await screen.findByRole("button", { name: "继续手动排班" }));
  const firstCell = screen.getByTestId("cell-e1-2026-07-20");
  await user.click(firstCell);
  await user.click(screen.getByRole("checkbox", { name: "早班" }));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(firstCell).toHaveTextContent("早班");
  expect(screen.getByText("2026-07-21 evening sales 岗位人力不足")).toBeInTheDocument();
});

it("loads persisted schedules, saves an early plus evening cell, and exposes Task 5 actions", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(detailResponse([], [
        { shiftType: "morning" },
        { shiftType: "evening" },
      ])), { status: 200, headers: { "content-type": "application/json" } }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: { saved: 2, plan: { version: 2 } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<GenerateStep planId="p1" readOnly={false} onPrev={() => undefined} />);

  expect(await screen.findByText("班表编辑与发布")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "复制历史" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "恢复推荐" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发布" })).toBeInTheDocument();
  expect(screen.getByText("上传 xlsx")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "导出 xlsx" })).toHaveAttribute(
    "href",
    "/api/schedule/export?planId=p1",
  );
  await user.click(screen.getByRole("button", { name: "保存草稿" }));

  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/schedule/save",
    expect.objectContaining({
      body: JSON.stringify({
        planId: "p1",
        version: 1,
        weekOf: "2026-07-20",
        assignments: [
          { userId: "e1", date: "2026-07-20", shiftType: "morning" },
          { userId: "e1", date: "2026-07-20", shiftType: "evening" },
        ],
        source: "manual",
      }),
    }),
  ));
  expect(await screen.findByText(/2 个班次/)).toBeInTheDocument();
});

it("blocks adjacent shifts in the shared client validator and shows the cell issue", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(detailResponse()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<GenerateStep planId="p1" readOnly={false} onPrev={() => undefined} />);

  await user.click(await screen.findByTestId("cell-e1-2026-07-20"));
  await user.click(screen.getByRole("checkbox", { name: "早班" }));
  await user.click(screen.getByRole("checkbox", { name: "午班" }));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByText("同日班次之间至少休息 4 小时")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
