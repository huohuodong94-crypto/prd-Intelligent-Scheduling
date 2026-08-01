import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

import EmployeesPage from "./EmployeesPage";
import WorkAreasPage from "./WorkAreasPage";
import WorkGroupsPage from "./WorkGroupsPage";

afterEach(() => {
  cleanup();
  navigation.refresh.mockClear();
});

const context = {
  storeId: "store-a",
  readOnly: false,
  onRefresh: vi.fn(async () => undefined),
};

const productionContext = {
  storeId: "store-a",
  readOnly: false,
};

describe("WorkAreasPage", () => {
  it("creates an area and refreshes the current query without navigation", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    render(
      <WorkAreasPage
        {...context}
        onRefresh={refresh}
        initialAreas={[{ id: "area-1", name: "卖场", code: "FLOOR", active: true, members: [] }]}
        onSave={save}
      />
    );

    expect(screen.getByText("卖场")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新增区域" }));
    const dialog = screen.getByRole("dialog", { name: "新增工作区域" });
    await user.type(within(dialog).getByLabelText("区域名称"), "收银区");
    await user.type(within(dialog).getByLabelText("区域编码"), "CHECKOUT");
    await user.click(within(dialog).getByRole("button", { name: "保存区域" }));

    expect(save).toHaveBeenCalledWith({ name: "收银区", code: "CHECKOUT", active: true });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps admin view read-only", () => {
    render(<WorkAreasPage {...context} readOnly initialAreas={[{ id: "area-1", name: "卖场", code: "FLOOR", active: true, members: [] }]} />);
    expect(screen.queryByRole("button", { name: "新增区域" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑区域" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停用区域" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除区域" })).not.toBeInTheDocument();
  });

  it("deletes an area and refreshes", async () => {
    const user = userEvent.setup();
    const remove = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    render(<WorkAreasPage {...context} onRefresh={refresh} initialAreas={[{ id: "area-1", name: "卖场", code: "FLOOR", active: false, members: [] }]} onDelete={remove} />);
    await user.click(screen.getByRole("button", { name: "删除区域" }));
    expect(remove).toHaveBeenCalledWith("area-1");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("falls back to router.refresh after an area mutation when onRefresh is not injected", async () => {
    const user = userEvent.setup();
    render(
      <WorkAreasPage
        {...productionContext}
        initialAreas={[]}
        onSave={vi.fn(async () => undefined)}
      />
    );
    await user.click(screen.getByRole("button", { name: "新增区域" }));
    const dialog = screen.getByRole("dialog", { name: "新增工作区域" });
    await user.type(within(dialog).getByLabelText("区域名称"), "收银区");
    await user.type(within(dialog).getByLabelText("区域编码"), "CHECKOUT");
    await user.click(within(dialog).getByRole("button", { name: "保存区域" }));
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});

describe("WorkGroupsPage", () => {
  it("adds only an employee as a member and preserves date-only keys", async () => {
    const user = userEvent.setup();
    const addMember = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    render(
      <WorkGroupsPage
        {...context}
        onRefresh={refresh}
        initialGroups={[{
          id: "group-1",
          name: "销售组",
          leaderId: "manager-1",
          leader: { id: "manager-1", name: "李经理" },
          volumeType: "traffic",
          active: true,
          members: [],
        }]}
        managers={[{ id: "manager-1", name: "李经理" }]}
        employees={[{ id: "employee-1", employeeNo: "WJ-001", name: "小王" }]}
        areas={[{ id: "area-1", name: "卖场", active: true }]}
        onAddMember={addMember}
      />
    );

    await user.click(screen.getByRole("button", { name: "添加成员" }));
    const dialog = screen.getByRole("dialog", { name: "设置成员有效期" });
    expect(within(dialog).queryByRole("option", { name: /李经理/ })).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("生效日期"));
    await user.type(within(dialog).getByLabelText("生效日期"), "2026-07-01");
    await user.click(within(dialog).getByRole("button", { name: "保存成员" }));

    expect(addMember).toHaveBeenCalledWith({
      workGroupId: "group-1",
      userId: "employee-1",
      workAreaId: "area-1",
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("views and deletes one membership period, while read-only mutation controls stay out of DOM", async () => {
    const user = userEvent.setup();
    const removeMember = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    const group = {
      id: "group-1",
      name: "销售组",
      leaderId: "manager-1",
      leader: { id: "manager-1", name: "李经理" },
      volumeType: "traffic",
      active: true,
      members: [{ id: "member-1", user: { id: "employee-1", employeeNo: "WJ-001", name: "小王" }, workArea: { id: "area-1", name: "卖场" }, effectiveFrom: "2026-07-01", effectiveTo: null }],
    };
    const { rerender } = render(<WorkGroupsPage {...context} onRefresh={refresh} initialGroups={[group]} managers={[group.leader]} employees={[group.members[0].user]} areas={[{ id: "area-1", name: "卖场", active: true }]} onDeleteMember={removeMember} />);
    await user.click(screen.getByRole("button", { name: "查看成员有效期" }));
    const drawer = screen.getByRole("dialog", { name: "销售组成员有效期" });
    expect(within(drawer).getByText(/2026-07-01/)).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "删除成员有效期" }));
    expect(removeMember).toHaveBeenCalledWith("member-1");
    expect(refresh).toHaveBeenCalledOnce();

    rerender(<WorkGroupsPage {...context} readOnly initialGroups={[group]} managers={[group.leader]} employees={[group.members[0].user]} areas={[{ id: "area-1", name: "卖场", active: true }]} />);
    expect(screen.queryByRole("button", { name: "新增工作组" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑工作组" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停用工作组" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除工作组" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加成员" })).not.toBeInTheDocument();
  });

  it("falls back to router.refresh after a member mutation when onRefresh is not injected", async () => {
    const user = userEvent.setup();
    render(
      <WorkGroupsPage
        {...productionContext}
        initialGroups={[{
          id: "group-1",
          name: "销售组",
          leaderId: "manager-1",
          leader: { id: "manager-1", name: "李经理" },
          volumeType: "traffic",
          active: true,
          members: [],
        }]}
        managers={[{ id: "manager-1", name: "李经理" }]}
        employees={[{ id: "employee-1", employeeNo: "WJ-001", name: "小王" }]}
        areas={[{ id: "area-1", name: "卖场", active: true }]}
        onAddMember={vi.fn(async () => undefined)}
      />
    );
    await user.click(screen.getByRole("button", { name: "添加成员" }));
    const dialog = screen.getByRole("dialog", { name: "设置成员有效期" });
    await user.type(within(dialog).getByLabelText("生效日期"), "2026-07-01");
    await user.click(within(dialog).getByRole("button", { name: "保存成员" }));
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});

describe("EmployeesPage", () => {
  it("shows employeeNo and filters manager/admin from schedulable rows", () => {
    render(
      <EmployeesPage
        {...context}
        initialEmployees={[
          {
            id: "employee-1",
            role: "employee",
            phone: "13800000001",
            employeeNo: "WJ-001",
            name: "小王",
            position: "sales",
            employmentType: "fulltime",
            maxWeeklyHours: 40,
            salesAbility: "high",
            performanceBand: "always",
            hireDate: "2026-05-01",
            memberships: [],
          },
          {
            id: "manager-1",
            role: "manager",
            phone: "13800000002",
            employeeNo: null,
            name: "李经理",
            position: null,
            employmentType: "fulltime",
            maxWeeklyHours: 40,
            salesAbility: "none",
            performanceBand: "frequently",
            hireDate: "2020-01-01",
            memberships: [],
          },
        ]}
      />
    );

    expect(screen.getByText("WJ-001")).toBeInTheDocument();
    expect(screen.getByText("新员工")).toBeInTheDocument();
    expect(screen.queryByText("李经理")).not.toBeInTheDocument();
  });

  it("shows only the inclusive membership effective today", () => {
    render(<EmployeesPage {...context} initialEmployees={[{
      id: "employee-1", role: "employee", phone: "13800000001", employeeNo: "WJ-001", name: "小王", position: "sales", employmentType: "fulltime", maxWeeklyHours: 40, salesAbility: "high", performanceBand: "always", hireDate: "2020-01-01",
      memberships: [
        { id: "future", workArea: { id: "future-area", name: "未来区域" }, workGroup: { id: "future-group", name: "未来组" }, effectiveFrom: "2099-01-01", effectiveTo: null },
        { id: "current", workArea: { id: "area-1", name: "当前区域" }, workGroup: { id: "group-1", name: "当前组" }, effectiveFrom: "2020-01-01", effectiveTo: "2090-12-31" },
        { id: "expired", workArea: { id: "old-area", name: "过期区域" }, workGroup: { id: "old-group", name: "过期组" }, effectiveFrom: "2019-01-01", effectiveTo: "2019-12-31" },
      ],
    }]} />);
    expect(screen.getByText("当前区域 / 当前组")).toBeInTheDocument();
    expect(screen.queryByText(/未来区域/)).not.toBeInTheDocument();
    expect(screen.queryByText(/过期区域/)).not.toBeInTheDocument();
  });

  it("falls back to router.refresh after an employee mutation when onRefresh is not injected", async () => {
    const user = userEvent.setup();
    render(
      <EmployeesPage
        {...productionContext}
        onSave={vi.fn(async () => undefined)}
        initialEmployees={[{
          id: "employee-1",
          role: "employee",
          phone: "13800000001",
          employeeNo: "WJ-001",
          name: "小王",
          position: "sales",
          employmentType: "fulltime",
          maxWeeklyHours: 40,
          salesAbility: "high",
          performanceBand: "always",
          hireDate: "2020-01-01",
          memberships: [],
        }]}
      />
    );
    await user.click(screen.getByRole("button", { name: "编辑标签" }));
    await user.click(screen.getByRole("button", { name: "保存员工" }));
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});
