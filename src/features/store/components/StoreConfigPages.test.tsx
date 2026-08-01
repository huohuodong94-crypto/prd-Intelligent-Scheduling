import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StoreBasicPage from "./StoreBasicPage";
import V2SPage from "./V2SPage";
import StaffingPage from "./StaffingPage";
import EventsPage from "./EventsPage";

const options = [
  { id: "store-a", name: "望京旗舰店", code: "WJ", active: true },
];

afterEach(cleanup);

const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isOpen: dayOfWeek !== 0,
  openTime: "09:00",
  closeTime: "21:00",
}));

describe("StoreBasicPage", () => {
  it("shows fixed shift labels and saves edited store basic fields", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <StoreBasicPage
        sessionStoreId="store-a"
        readOnly={false}
        storeOptions={options}
        initialStore={{
          id: "store-a",
          name: "望京旗舰店",
          code: "WJ",
          address: "望京路 1 号",
          active: true,
        }}
        initialDays={days}
        onSaveBasic={save}
      />
    );

    expect(screen.getByText("早班 09:00-13:00")).toBeInTheDocument();
    expect(screen.getByText("午班 13:00-17:00")).toBeInTheDocument();
    expect(screen.getByText("晚班 17:00-21:00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑门店" }));
    await user.clear(screen.getByLabelText("门店名称"));
    await user.type(screen.getByLabelText("门店名称"), "望京一店");
    await user.click(screen.getByRole("button", { name: "保存门店" }));
    expect(save).toHaveBeenCalledWith({
      storeId: "store-a",
      name: "望京一店",
      code: "WJ",
      address: "望京路 1 号",
      active: true,
    });
  });

  it("keeps admin read-only controls out of the DOM", () => {
    render(
      <StoreBasicPage
        sessionStoreId={null}
        readOnly
        storeOptions={options}
        initialStore={{ id: "store-a", name: "望京旗舰店", code: "WJ", address: null, active: true }}
        initialDays={days}
      />
    );
    expect(screen.queryByRole("button", { name: "编辑门店" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存营业日" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="time"]')).not.toBeInTheDocument();
    expect(screen.getAllByText("09:00")).toHaveLength(7);
    expect(screen.getAllByText("21:00")).toHaveLength(7);
  });
});

describe("V2SPage", () => {
  it("batches edited V2S rows and preserves untouched values", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <V2SPage
        sessionStoreId="store-a"
        readOnly={false}
        storeOptions={options}
        initialRows={[{ dayOfWeek: 1, v2sLower: 30, v2sUpper: 60 }]}
        onSave={save}
      />
    );
    await user.clear(screen.getByLabelText("周一 V2S 下限"));
    await user.type(screen.getByLabelText("周一 V2S 下限"), "35");
    await user.click(screen.getByRole("button", { name: "批量保存" }));
    expect(save).toHaveBeenCalledWith([{ dayOfWeek: 1, v2sLower: 35, v2sUpper: 60 }]);
  });

  it("renders V2S values as text for read-only admin", () => {
    render(
      <V2SPage
        sessionStoreId={null}
        readOnly
        storeOptions={options}
        initialRows={[{ dayOfWeek: 1, v2sLower: 30, v2sUpper: 60 }]}
      />
    );
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
  });
});

describe("StaffingPage", () => {
  it("batches edited staffing rows without exposing manager as a position", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <StaffingPage
        sessionStoreId="store-a"
        readOnly={false}
        storeOptions={options}
        initialRows={[
          { dayOfWeek: 1, timeSlot: "morning", position: "cashier", minHeadcount: 1 },
          { dayOfWeek: 1, timeSlot: "morning", position: "sales", minHeadcount: 2 },
        ]}
        onSave={save}
      />
    );
    expect(screen.queryByText("店长")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("周一 早班 收银 最低人数"));
    await user.type(screen.getByLabelText("周一 早班 收银 最低人数"), "3");
    await user.click(screen.getByRole("button", { name: "批量保存" }));
    expect(save).toHaveBeenCalledWith([
      { dayOfWeek: 1, timeSlot: "morning", position: "cashier", minHeadcount: 3 },
      { dayOfWeek: 1, timeSlot: "morning", position: "sales", minHeadcount: 2 },
    ]);
  });

  it("renders staffing headcount as text for read-only admin", () => {
    render(
      <StaffingPage
        sessionStoreId={null}
        readOnly
        storeOptions={options}
        initialRows={[
          { dayOfWeek: 1, timeSlot: "morning", position: "cashier", minHeadcount: 1 },
        ]}
      />
    );
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

describe("EventsPage", () => {
  it("toggles a month date with the exact local YYYY-MM-DD key", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn().mockResolvedValue(undefined);
    render(
      <EventsPage
        sessionStoreId="store-a"
        readOnly={false}
        storeOptions={options}
        initialMonth="2026-07"
        initialEvents={[]}
        onToggle={toggle}
      />
    );
    await user.click(screen.getByRole("button", { name: "2026-07-19" }));
    const dialog = screen.getByRole("dialog", { name: "设置活动" });
    await user.selectOptions(within(dialog).getByLabelText("活动类型"), "promo");
    await user.click(within(dialog).getByRole("button", { name: "确认切换" }));
    expect(toggle).toHaveBeenCalledWith({ date: "2026-07-19", label: "promo", factor: 1.3 });
  });

  it("renders the admin year view without mutation controls", () => {
    render(
      <EventsPage
        sessionStoreId={null}
        readOnly
        storeOptions={options}
        initialMonth="2026-07"
        initialEvents={[{ date: "2026-07-19", label: "holiday", factor: 1.4 }]}
      />
    );
    expect(screen.getByLabelText("2026 年活动日历")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认切换" })).not.toBeInTheDocument();
  });
});
