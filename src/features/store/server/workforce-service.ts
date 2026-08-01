import { Prisma, type PrismaClient } from "@prisma/client";

import type { StoreScope } from "@/lib/authorization";
import {
  dateOnlyToDate,
  dateToDateOnly,
} from "@/lib/contracts/store";
import type {
  EmployeeInput,
  WorkAreaInput,
  WorkGroupInput,
  WorkGroupMemberInput,
} from "@/lib/contracts/workforce";
import { employeeInputSchema, employeeOutputSchema } from "@/lib/contracts/workforce";
import { prisma } from "@/lib/db";
import { dateRangesOverlap } from "./membership-overlap";

export class WorkforceConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "WorkforceConflictError";
  }
}

export class WorkforceNotFoundError extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "WorkforceNotFoundError";
  }
}

export function workforceErrorResponse(error: unknown): { message: string; status: number } {
  if (error instanceof WorkforceConflictError || error instanceof WorkforceNotFoundError) {
    return { message: error.message, status: error.status };
  }
  return { message: "工作配置操作失败", status: 500 };
}

type WorkforceDb = PrismaClient;

const serializable = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
} as const;

function isConcurrencyRace(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1008", "P2002", "P2028", "P2034"].includes(error.code);
  }
  return error instanceof Error && /database is locked|serialization|write conflict/i.test(error.message);
}

export function mapWorkforceConcurrencyError(
  error: unknown,
  message: string
): WorkforceConflictError | null {
  return isConcurrencyRace(error) ? new WorkforceConflictError(message) : null;
}

function mapConflict(error: unknown, fallback: string): never {
  if (error instanceof WorkforceConflictError || error instanceof WorkforceNotFoundError) {
    throw error;
  }
  const race = mapWorkforceConcurrencyError(error, fallback);
  if (race) throw race;
  throw error;
}

function assertSameStore(scope: StoreScope, values: Array<string | null | undefined>) {
  if (values.some((storeId) => storeId !== scope.storeId)) {
    throw new WorkforceConflictError("员工、区域和工作组必须属于同一门店");
  }
}

function currentLocalDate(): Date {
  return dateOnlyToDate(dateToDateOnly(new Date()));
}

function serializeMembership<T extends {
  effectiveFrom: Date;
  effectiveTo: Date | null;
}>(membership: T) {
  return {
    ...membership,
    effectiveFrom: dateToDateOnly(membership.effectiveFrom),
    effectiveTo: membership.effectiveTo ? dateToDateOnly(membership.effectiveTo) : null,
  };
}

export function listWorkAreas(scope: StoreScope, db: WorkforceDb = prisma) {
  return db.workArea.findMany({
    where: { storeId: scope.storeId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true } }, workGroup: { select: { id: true, name: true } } },
        orderBy: { effectiveFrom: "desc" },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export function createWorkArea(
  scope: StoreScope,
  input: WorkAreaInput,
  db: WorkforceDb = prisma
) {
  return db.workArea
    .create({
      data: {
        storeId: scope.storeId,
        name: input.name,
        code: input.code,
        active: input.active,
      },
    })
    .catch((error) => mapConflict(error, "工作区域编码已存在"));
}

export async function updateWorkArea(
  scope: StoreScope,
  input: WorkAreaInput & { id: string },
  db: WorkforceDb = prisma
) {
  try {
    return await db.$transaction(async (tx) => {
      const area = await tx.workArea.findUnique({ where: { id: input.id } });
      if (!area || area.storeId !== scope.storeId) throw new WorkforceNotFoundError("工作区域不存在");
      if (area.active && !input.active) {
        const today = currentLocalDate();
        const currentMembers = await tx.workGroupMember.count({
          where: {
            workAreaId: area.id,
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          },
        });
        if (currentMembers > 0) throw new WorkforceConflictError("工作区域仍有当前有效成员，无法停用");
      }
      return tx.workArea.update({
        where: { id: area.id },
        data: { name: input.name, code: input.code, active: input.active },
      });
    }, serializable);
  } catch (error) {
    return mapConflict(error, "工作区域更新冲突");
  }
}

export async function deleteWorkArea(
  scope: StoreScope,
  id: string,
  db: WorkforceDb = prisma
) {
  try {
    return await db.$transaction(async (tx) => {
      const area = await tx.workArea.findUnique({ where: { id }, select: { id: true, storeId: true } });
      if (!area || area.storeId !== scope.storeId) throw new WorkforceNotFoundError("工作区域不存在");
      if (await tx.workGroupMember.count({ where: { workAreaId: id } })) {
        throw new WorkforceConflictError("工作区域仍有关联成员，无法删除");
      }
      await tx.workArea.delete({ where: { id } });
      return { id };
    }, serializable);
  } catch (error) {
    return mapConflict(error, "工作区域删除冲突");
  }
}

async function assertLeader(
  scope: StoreScope,
  leaderId: string,
  tx: Prisma.TransactionClient
) {
  const leader = await tx.user.findUnique({
    where: { id: leaderId },
    select: { role: true, storeId: true },
  });
  if (!leader || leader.role !== "manager" || leader.storeId !== scope.storeId) {
    throw new WorkforceConflictError("组长必须是本门店经理");
  }
}

export function listWorkGroups(scope: StoreScope, db: WorkforceDb = prisma) {
  return db.workGroup.findMany({
    where: { storeId: scope.storeId },
    include: {
      leader: { select: { id: true, name: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, employeeNo: true } },
          workArea: { select: { id: true, name: true } },
        },
        orderBy: { effectiveFrom: "desc" },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  }).then((groups) => groups.map((group) => ({
    ...group,
    members: group.members.map(serializeMembership),
  })));
}

export async function createWorkGroup(
  scope: StoreScope,
  input: WorkGroupInput,
  db: WorkforceDb = prisma
) {
  try {
    return await db.$transaction(async (tx) => {
      await assertLeader(scope, input.leaderId, tx);
      return tx.workGroup.create({
        data: {
          storeId: scope.storeId,
          name: input.name,
          leaderId: input.leaderId,
          volumeType: input.volumeType,
          active: input.active,
        },
      });
    }, serializable);
  } catch (error) {
    return mapConflict(error, "工作组名称已存在或写入冲突");
  }
}

export async function updateWorkGroup(
  scope: StoreScope,
  input: WorkGroupInput & { id: string },
  db: WorkforceDb = prisma
) {
  try {
    return await db.$transaction(async (tx) => {
      const group = await tx.workGroup.findUnique({ where: { id: input.id } });
      if (!group || group.storeId !== scope.storeId) throw new WorkforceNotFoundError("工作组不存在");
      await assertLeader(scope, input.leaderId, tx);
      if (group.active && !input.active) {
        const today = currentLocalDate();
        const currentMembers = await tx.workGroupMember.count({
          where: {
            workGroupId: group.id,
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          },
        });
        if (currentMembers > 0) throw new WorkforceConflictError("工作组仍有当前有效成员，无法停用");
      }
      return tx.workGroup.update({
        where: { id: group.id },
        data: {
          name: input.name,
          leaderId: input.leaderId,
          volumeType: input.volumeType,
          active: input.active,
        },
      });
    }, serializable);
  } catch (error) {
    return mapConflict(error, "工作组更新冲突");
  }
}

export async function deleteWorkGroup(
  scope: StoreScope,
  id: string,
  db: WorkforceDb = prisma
) {
  try {
    return await db.$transaction(async (tx) => {
      const group = await tx.workGroup.findUnique({ where: { id }, select: { id: true, storeId: true } });
      if (!group || group.storeId !== scope.storeId) throw new WorkforceNotFoundError("工作组不存在");
      if (await tx.workGroupMember.count({ where: { workGroupId: id } })) {
        throw new WorkforceConflictError("工作组仍有关联成员，无法删除");
      }
      await tx.workGroup.delete({ where: { id } });
      return { id };
    }, serializable);
  } catch (error) {
    return mapConflict(error, "工作组删除冲突");
  }
}

export async function addWorkGroupMember(
  scope: StoreScope,
  input: WorkGroupMemberInput,
  db: WorkforceDb = prisma
) {
  const effectiveFrom = dateOnlyToDate(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? dateOnlyToDate(input.effectiveTo) : null;
  try {
    const membership = await db.$transaction(async (tx) => {
      const [group, area, user] = await Promise.all([
        tx.workGroup.findUnique({ where: { id: input.workGroupId }, select: { storeId: true, active: true } }),
        tx.workArea.findUnique({ where: { id: input.workAreaId }, select: { storeId: true, active: true } }),
        tx.user.findUnique({ where: { id: input.userId }, select: { storeId: true, role: true } }),
      ]);
      if (!group || !area || !user) throw new WorkforceConflictError("员工、区域和工作组必须属于同一门店");
      assertSameStore(scope, [group.storeId, area.storeId, user.storeId]);
      if (user.role !== "employee") throw new WorkforceConflictError("工作组成员必须是员工");
      if (!group.active || !area.active) throw new WorkforceConflictError("工作组和工作区域必须处于启用状态");

      const existing = await tx.workGroupMember.findMany({
        where: { workGroupId: input.workGroupId, userId: input.userId },
        select: { effectiveFrom: true, effectiveTo: true },
      });
      if (existing.some((row) => dateRangesOverlap(effectiveFrom, effectiveTo, row.effectiveFrom, row.effectiveTo))) {
        throw new WorkforceConflictError("成员有效期与现有记录重叠");
      }
      return tx.workGroupMember.create({
        data: {
          workGroupId: input.workGroupId,
          userId: input.userId,
          workAreaId: input.workAreaId,
          effectiveFrom,
          effectiveTo,
        },
      });
    }, serializable);
    return serializeMembership(membership);
  } catch (error) {
    return mapConflict(error, "成员有效期并发冲突");
  }
}

export async function deleteWorkGroupMember(
  scope: StoreScope,
  id: string,
  db: WorkforceDb = prisma
) {
  const membership = await db.workGroupMember.findUnique({
    where: { id },
    select: { id: true, workGroup: { select: { storeId: true } } },
  });
  if (!membership || membership.workGroup.storeId !== scope.storeId) {
    throw new WorkforceNotFoundError("成员有效期记录不存在");
  }
  await db.workGroupMember.delete({ where: { id } });
  return { id };
}

export async function listEmployees(scope: StoreScope, db: WorkforceDb = prisma) {
  const employees = await db.user.findMany({
    where: { storeId: scope.storeId, role: "employee" },
    select: {
      id: true,
      phone: true,
      employeeNo: true,
      name: true,
      position: true,
      employmentType: true,
      maxWeeklyHours: true,
      salesAbility: true,
      performanceBand: true,
      hireDate: true,
      workGroupMemberships: {
        include: {
          workArea: { select: { id: true, name: true } },
          workGroup: { select: { id: true, name: true } },
        },
        orderBy: { effectiveFrom: "desc" },
      },
    },
    orderBy: [{ employeeNo: "asc" }, { name: "asc" }],
  });
  return employees.map((employee) => {
    const input = employeeOutputSchema.parse({
      id: employee.id,
      phone: employee.phone,
      employeeNo: employee.employeeNo,
      name: employee.name,
      position: employee.position,
      employmentType: employee.employmentType,
      maxWeeklyHours: employee.maxWeeklyHours,
      salesAbility: employee.salesAbility,
      performanceBand: employee.performanceBand,
      hireDate: dateToDateOnly(employee.hireDate),
    });
    return {
      ...input,
      id: employee.id,
      role: "employee" as const,
      memberships: employee.workGroupMemberships.map(serializeMembership),
    };
  });
}

export async function getWorkforceOptions(scope: StoreScope, db: WorkforceDb = prisma) {
  const [managers, employees, areas] = await Promise.all([
    db.user.findMany({
      where: { storeId: scope.storeId, role: "manager" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { storeId: scope.storeId, role: "employee" },
      select: { id: true, employeeNo: true, name: true },
      orderBy: [{ employeeNo: "asc" }, { name: "asc" }],
    }),
    db.workArea.findMany({
      where: { storeId: scope.storeId },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { managers, employees, areas };
}

function employeeData(scope: StoreScope, input: EmployeeInput) {
  return {
    storeId: scope.storeId,
    role: "employee",
    phone: input.phone,
    employeeNo: input.employeeNo,
    name: input.name,
    position: input.position,
    employmentType: input.employmentType,
    maxWeeklyHours: input.maxWeeklyHours,
    salesAbility: input.salesAbility,
    performanceBand: input.performanceBand,
    hireDate: dateOnlyToDate(input.hireDate),
  } as const;
}

export async function createEmployee(
  scope: StoreScope,
  input: EmployeeInput,
  db: WorkforceDb = prisma
) {
  const parsed = employeeInputSchema.parse(input);
  try {
    const employee = await db.user.create({ data: employeeData(scope, parsed) });
    return { ...employee, hireDate: dateToDateOnly(employee.hireDate) };
  } catch (error) {
    return mapConflict(error, "员工编号或手机号已存在");
  }
}

export async function updateEmployee(
  scope: StoreScope,
  input: EmployeeInput & { id: string },
  db: WorkforceDb = prisma
) {
  const parsed = employeeInputSchema.parse(input);
  const employee = await db.user.findUnique({
    where: { id: input.id },
    select: { id: true, storeId: true, role: true },
  });
  if (!employee || employee.storeId !== scope.storeId || employee.role !== "employee") {
    throw new WorkforceNotFoundError("员工不存在");
  }
  try {
    const updated = await db.user.update({
      where: { id: employee.id },
      data: employeeData(scope, parsed),
    });
    return { ...updated, hireDate: dateToDateOnly(updated.hireDate) };
  } catch (error) {
    return mapConflict(error, "员工编号或手机号已存在");
  }
}
