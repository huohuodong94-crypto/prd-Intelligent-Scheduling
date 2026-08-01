import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import type { StoreScope } from "@/lib/authorization";
import {
  dateOnlyToDate,
  dateToDateOnly,
  staffingRowSchema,
  storeEventSchema,
  type OperatingDayInput,
  type StaffingRow,
  type StoreBasicInput,
  type StoreEventInput,
  type StoreEventKey,
  type StoreOption,
  type V2SRow,
} from "@/lib/contracts/store";

const storeSelect = {
  id: true,
  name: true,
  code: true,
  address: true,
  active: true,
} as const;

export async function listStoreOptions(user: SessionUser): Promise<StoreOption[]> {
  return prisma.store.findMany({
    where: user.role === "manager" ? { id: user.storeId ?? "" } : undefined,
    select: { id: true, name: true, code: true, active: true },
    orderBy: { name: "asc" },
  });
}

export function getStoreBasic(scope: StoreScope) {
  return prisma.store.findUniqueOrThrow({
    where: { id: scope.storeId },
    select: storeSelect,
  });
}

export function updateStoreBasic(scope: StoreScope, input: StoreBasicInput) {
  return prisma.store.update({
    where: { id: scope.storeId },
    data: {
      name: input.name,
      code: input.code,
      address: input.address,
      active: input.active,
    },
    select: storeSelect,
  });
}

export function getOperatingDays(scope: StoreScope) {
  return prisma.storeOperatingDay.findMany({
    where: { storeId: scope.storeId },
    select: {
      dayOfWeek: true,
      isOpen: true,
      openTime: true,
      closeTime: true,
    },
    orderBy: { dayOfWeek: "asc" },
  });
}

export async function replaceOperatingDays(
  scope: StoreScope,
  days: OperatingDayInput[]
) {
  return prisma.$transaction(async (tx) => {
    await tx.storeOperatingDay.deleteMany({ where: { storeId: scope.storeId } });
    await tx.storeOperatingDay.createMany({
      data: days.map((day) => ({ ...day, storeId: scope.storeId })),
    });
    return tx.storeOperatingDay.findMany({
      where: { storeId: scope.storeId },
      select: {
        dayOfWeek: true,
        isOpen: true,
        openTime: true,
        closeTime: true,
      },
      orderBy: { dayOfWeek: "asc" },
    });
  });
}

export function getV2SRows(scope: StoreScope) {
  return prisma.v2SConfig.findMany({
    where: { storeId: scope.storeId },
    select: { dayOfWeek: true, v2sLower: true, v2sUpper: true },
    orderBy: { dayOfWeek: "asc" },
  });
}

export async function replaceV2SRows(scope: StoreScope, rows: V2SRow[]) {
  return prisma.$transaction(async (tx) => {
    await tx.v2SConfig.deleteMany({ where: { storeId: scope.storeId } });
    await tx.v2SConfig.createMany({
      data: rows.map((row) => ({ ...row, storeId: scope.storeId })),
    });
    return tx.v2SConfig.findMany({
      where: { storeId: scope.storeId },
      select: { dayOfWeek: true, v2sLower: true, v2sUpper: true },
      orderBy: { dayOfWeek: "asc" },
    });
  });
}

export async function getStaffingRows(scope: StoreScope) {
  const rows = await prisma.minStaffingConfig.findMany({
    where: { storeId: scope.storeId },
    select: {
      dayOfWeek: true,
      timeSlot: true,
      position: true,
      minHeadcount: true,
    },
    orderBy: [{ dayOfWeek: "asc" }, { timeSlot: "asc" }, { position: "asc" }],
  });
  return rows.map((row) => staffingRowSchema.parse(row));
}

export async function replaceStaffingRows(scope: StoreScope, rows: StaffingRow[]) {
  return prisma.$transaction(async (tx) => {
    await tx.minStaffingConfig.deleteMany({ where: { storeId: scope.storeId } });
    await tx.minStaffingConfig.createMany({
      data: rows.map((row) => ({ ...row, storeId: scope.storeId })),
    });
    return tx.minStaffingConfig.findMany({
      where: { storeId: scope.storeId },
      orderBy: [{ dayOfWeek: "asc" }, { timeSlot: "asc" }, { position: "asc" }],
    });
  });
}

function rangeForEvents(month?: string, year?: number) {
  if (month) {
    const [monthYear, monthNumber] = month.split("-").map(Number);
    return {
      gte: new Date(monthYear, monthNumber - 1, 1),
      lt: new Date(monthYear, monthNumber, 1),
    };
  }
  const selectedYear = year ?? new Date().getFullYear();
  return {
    gte: new Date(selectedYear, 0, 1),
    lt: new Date(selectedYear + 1, 0, 1),
  };
}

export async function getStoreEvents(
  scope: StoreScope,
  range: { month?: string; year?: number } = {}
) {
  const events = await prisma.storeEvent.findMany({
    where: { storeId: scope.storeId, date: rangeForEvents(range.month, range.year) },
    select: { date: true, label: true, factor: true },
    orderBy: [{ date: "asc" }, { label: "asc" }],
  });
  return events.map((event) =>
    storeEventSchema.parse({ ...event, date: dateToDateOnly(event.date) })
  );
}

export async function createStoreEvent(scope: StoreScope, input: StoreEventInput) {
  const event = await prisma.storeEvent.create({
    data: {
      storeId: scope.storeId,
      date: dateOnlyToDate(input.date),
      label: input.label,
      factor: input.factor,
    },
    select: { date: true, label: true, factor: true },
  });
  return storeEventSchema.parse({ ...event, date: dateToDateOnly(event.date) });
}

export async function deleteStoreEvent(scope: StoreScope, key: StoreEventKey) {
  await prisma.storeEvent.deleteMany({
    where: {
      storeId: scope.storeId,
      date: dateOnlyToDate(key.date),
      label: key.label,
    },
  });
  return key;
}
