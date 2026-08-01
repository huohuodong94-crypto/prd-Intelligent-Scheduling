import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClockCode } from "@/features/attendance/server/clock-code";
import { prisma, resetTestDb } from "../helpers/test-db";

const port = 3217;
const origin = `http://127.0.0.1:${port}`;
const secret = "task7-http-secret";
const now = new Date("2026-07-20T09:10:00+08:00");
let server: ChildProcess | null = null;

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/auth/login`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      if (response.status > 0) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("Task 7 HTTP test server did not start");
}

async function login(phone: string) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code: "123456" }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toContain("wfm_session=");
  return cookie!.split(";")[0];
}

async function request(path: string, cookie?: string, init: RequestInit = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

beforeAll(async () => {
  await resetTestDb();
  await prisma.store.createMany({ data: [
    { id: "http-store-a", name: "HTTP A 店", code: "HTTP-A" },
    { id: "http-store-b", name: "HTTP B 店", code: "HTTP-B" },
  ] });
  await prisma.user.createMany({ data: [
    { id: "http-manager-a", phone: "13970000001", name: "A 店经理", role: "manager", storeId: "http-store-a", position: null },
    { id: "http-manager-b", phone: "13970000002", name: "B 店经理", role: "manager", storeId: "http-store-b", position: null },
    { id: "http-employee-a", phone: "13970000003", employeeNo: "HTTP-A-001", name: "A 店员工", role: "employee", storeId: "http-store-a", position: "sales" },
    { id: "http-employee-b", phone: "13970000004", employeeNo: "HTTP-B-001", name: "B 店员工", role: "employee", storeId: "http-store-b", position: "sales" },
    { id: "http-admin", phone: "13970000005", name: "系统管理员", role: "admin", storeId: null, position: null },
    { id: "http-admin-bound", phone: "13970000006", name: "绑定门店管理员", role: "admin", storeId: "http-store-a", position: null },
  ] });
  await prisma.attendanceRecord.createMany({ data: [
    { userId: "http-employee-a", storeId: "http-store-a", time: new Date("2026-07-19T08:00:00+08:00"), direction: "out", corrected: true },
    { userId: "http-employee-a", storeId: "http-store-a", time: new Date("2026-07-19T09:00:00+08:00"), direction: "in", viaCode: true, clockWindow: "http-a-old" },
    { userId: "http-employee-b", storeId: "http-store-b", time: new Date("2026-07-19T09:00:00+08:00"), direction: "in", viaCode: true, clockWindow: "http-b-old" },
  ] });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      AUTH_SECRET: "task7-http-auth-secret",
      FIXED_OTP_CODE: "123456",
      CLOCK_CODE_SECRET: secret,
      WFM_E2E_NOW: now.toISOString(),
    },
    stdio: "ignore",
  });
  await waitForServer();
}, 45_000);

afterAll(async () => {
  server?.kill("SIGTERM");
  await prisma.$disconnect();
});

describe("Task 7 real HTTP auth and store matrix", () => {
  it("requires a manager bound to the current store for dynamic codes", async () => {
    expect((await request("/api/clock-code")).status).toBe(401);
    const manager = await login("13970000001");
    const employee = await login("13970000003");
    const admin = await login("13970000005");
    const response = await request("/api/clock-code", manager);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ code: expect.stringMatching(/^\d{6}$/), refreshAt: expect.any(String), expiresAt: expect.any(String) });
    expect((await request("/api/clock-code", employee)).status).toBe(403);
    expect((await request("/api/clock-code", admin)).status).toBe(403);
  });

  it("punches only for the employee session and rejects forged scope", async () => {
    const employee = await login("13970000003");
    const manager = await login("13970000001");
    const code = createClockCode("http-store-a", now, secret).code;
    const forged = await request("/api/attendance/punch", employee, { method: "POST", body: JSON.stringify({ direction: "out", code, userId: "http-employee-b", storeId: "http-store-b" }) });
    expect(forged.status).toBe(400);
    const response = await request("/api/attendance/punch", employee, { method: "POST", body: JSON.stringify({ direction: "out", code }) });
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ userId: "http-employee-a", storeId: "http-store-a", direction: "out", viaCode: true });
    expect((await request("/api/attendance/punch", manager, { method: "POST", body: JSON.stringify({ direction: "in", code }) })).status).toBe(403);
    const employeeB = await login("13970000004");
    expect((await request("/api/attendance/punch", employeeB, { method: "POST", body: JSON.stringify({ direction: "out", code }) })).status).toBe(400);
  });

  it("rejects unauthenticated and read-only roles across attendance endpoints", async () => {
    const employeeCookie = await login("13970000003");
    const admin = await login("13970000005");
    const payload = JSON.stringify({ direction: "in", code: "000000" });
    expect((await request("/api/attendance/punch", undefined, { method: "POST", body: payload })).status).toBe(401);
    expect((await request("/api/attendance/punch", admin, { method: "POST", body: payload })).status).toBe(403);
    expect((await request("/api/attendance/punches")).status).toBe(401);
    expect((await request("/api/attendance/daily?from=2026-07-20&to=2026-07-20")).status).toBe(401);
    expect((await request("/api/attendance/daily?from=2026-07-20&to=2026-07-20", employeeCookie)).status).toBe(403);
    const recalculate = { method: "POST", body: JSON.stringify({ from: "2026-07-20", to: "2026-07-20" }) };
    expect((await request("/api/attendance/daily/recalculate", undefined, recalculate)).status).toBe(401);
    expect((await request("/api/attendance/daily/recalculate", employeeCookie, recalculate)).status).toBe(403);
  });

  it("scopes punch history for managers and requires an admin store", async () => {
    const manager = await login("13970000001");
    const employee = await login("13970000003");
    const admin = await login("13970000005");
    const boundAdmin = await login("13970000006");
    expect((await request("/api/attendance/punches?storeId=http-store-b", manager)).status).toBe(403);
    const own = await request("/api/attendance/punches", manager);
    expect(own.status).toBe(200);
    const ownRows = (await own.json()).data as Array<{ storeId: string; source: string; valid: boolean }>;
    expect(ownRows.every((row) => row.storeId === "http-store-a")).toBe(true);
    expect(ownRows.find((row) => row.source === "correction")).toMatchObject({ source: "correction", valid: true });
    expect((await request("/api/attendance/punches", admin)).status).toBe(400);
    expect((await request("/api/attendance/punches", boundAdmin)).status).toBe(400);
    const selected = await request("/api/attendance/punches?storeId=http-store-b", admin);
    expect(selected.status).toBe(200);
    expect((await selected.json()).data.every((row: { storeId: string }) => row.storeId === "http-store-b")).toBe(true);
    expect((await request("/api/attendance/punches", employee)).status).toBe(403);
  });

  it("keeps daily writes manager-only and admin reads explicitly scoped", async () => {
    const manager = await login("13970000001");
    const admin = await login("13970000005");
    const boundAdmin = await login("13970000006");
    expect((await request("/api/attendance/daily?from=2026-07-20&to=2026-07-20", admin)).status).toBe(400);
    expect((await request("/api/attendance/daily?from=2026-07-20&to=2026-07-20", boundAdmin)).status).toBe(400);
    expect((await request("/api/attendance/daily?storeId=http-store-a&from=2026-07-20&to=2026-07-20", admin)).status).toBe(200);
    expect((await request("/api/attendance/daily/recalculate", admin, { method: "POST", body: JSON.stringify({ from: "2026-07-20", to: "2026-07-20" }) })).status).toBe(403);
    expect((await request("/api/attendance/daily/recalculate", manager, { method: "POST", body: JSON.stringify({ from: "2026-07-20", to: "2026-07-20", storeId: "http-store-b" }) })).status).toBe(400);
  });

  it("enforces confirm and unconfirm auth plus revision CAS round trips", async () => {
    const manager = await login("13970000001");
    const employeeCookie = await login("13970000003");
    const admin = await login("13970000005");
    const row = await prisma.attendanceExceptionConfirmation.create({ data: {
      storeId: "http-store-a", userId: "http-employee-a", date: new Date("2026-07-20T00:00:00+08:00"), type: "late",
    } });
    const body = JSON.stringify({ items: [{ id: row.id, revision: row.revision }] });
    expect((await request("/api/attendance/daily/confirm", undefined, { method: "POST", body })).status).toBe(401);
    expect((await request("/api/attendance/daily/confirm", employeeCookie, { method: "POST", body })).status).toBe(403);
    expect((await request("/api/attendance/daily/confirm", admin, { method: "POST", body })).status).toBe(403);
    expect((await request("/api/attendance/daily/confirm", manager, { method: "POST", body })).status).toBe(200);
    const confirmed = await prisma.attendanceExceptionConfirmation.findUniqueOrThrow({ where: { id: row.id } });
    expect(confirmed).toMatchObject({ status: "confirmed", revision: 2 });
    expect((await request("/api/attendance/daily/unconfirm", manager, { method: "POST", body })).status).toBe(409);
    expect((await request("/api/attendance/daily/unconfirm", manager, { method: "POST", body: JSON.stringify({ items: [{ id: row.id, revision: confirmed.revision }] }) })).status).toBe(200);
    const unconfirmed = await prisma.attendanceExceptionConfirmation.findUniqueOrThrow({ where: { id: row.id } });
    expect(unconfirmed).toMatchObject({ status: "unconfirmed", revision: 3 });
    expect((await request("/api/attendance/daily/confirm", manager, { method: "POST", body })).status).toBe(409);
  });

  it("rolls back HTTP mixed-type and cross-store confirmation batches", async () => {
    const manager = await login("13970000001");
    const date = new Date("2026-07-21T00:00:00+08:00");
    const mixed = await Promise.all([
      prisma.attendanceExceptionConfirmation.create({ data: { storeId: "http-store-a", userId: "http-employee-a", date, type: "late" } }),
      prisma.attendanceExceptionConfirmation.create({ data: { storeId: "http-store-a", userId: "http-employee-a", date, type: "missing_in" } }),
    ]);
    const mixedResponse = await request("/api/attendance/daily/confirm", manager, { method: "POST", body: JSON.stringify({ items: mixed.map((row) => ({ id: row.id, revision: row.revision })) }) });
    expect(mixedResponse.status).toBe(409);
    expect(await prisma.attendanceExceptionConfirmation.count({ where: { id: { in: mixed.map((row) => row.id) }, status: "unconfirmed" } })).toBe(2);
    const foreign = await prisma.attendanceExceptionConfirmation.create({ data: { storeId: "http-store-b", userId: "http-employee-b", date, type: "late" } });
    expect((await request("/api/attendance/daily/confirm", manager, { method: "POST", body: JSON.stringify({ items: [{ id: foreign.id, revision: foreign.revision }] }) })).status).toBe(403);
    expect(await prisma.attendanceExceptionConfirmation.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ status: "unconfirmed", revision: 1 });
  });

  it("allows only a manager to create same-store employee proxy requests", async () => {
    const manager = await login("13970000001");
    const admin = await login("13970000005");
    const employeeCookie = await login("13970000003");
    const valid = { action: "proxy_punch_correction", userId: "http-employee-a", date: "2026-07-20", direction: "in", requestedTime: "2026-07-20T09:00:00+08:00", reason: "漏打卡" };
    const created = await request("/api/attendance/daily", manager, { method: "POST", body: JSON.stringify(valid) });
    expect(created.status).toBe(201);
    expect((await created.json()).data).toMatchObject({ userId: "http-employee-a", status: "pending" });
    expect((await request("/api/attendance/daily", manager, { method: "POST", body: JSON.stringify({ ...valid, userId: "http-employee-b" }) })).status).toBe(403);
    expect((await request("/api/attendance/daily", manager, { method: "POST", body: JSON.stringify({ ...valid, userId: "http-manager-a" }) })).status).toBe(403);
    expect((await request("/api/attendance/daily", admin, { method: "POST", body: JSON.stringify(valid) })).status).toBe(403);
    expect((await request("/api/attendance/daily", employeeCookie, { method: "POST", body: JSON.stringify(valid) })).status).toBe(403);
  });

  it("keeps legacy GET employee-self and makes legacy POST a zero-write 308", async () => {
    const employee = await login("13970000003");
    const manager = await login("13970000001");
    const before = await prisma.attendanceRecord.count();
    const get = await request("/api/attendance", employee);
    expect(get.status).toBe(200);
    const rows = (await get.json()).data as Array<{ userId: string; source: string; valid: boolean }>;
    expect(rows.every((row) => row.userId === "http-employee-a")).toBe(true);
    expect(rows.find((row) => row.source === "correction")).toMatchObject({ source: "correction", valid: true });
    expect((await request("/api/attendance", manager)).status).toBe(403);
    const post = await request("/api/attendance", employee, { method: "POST", body: JSON.stringify({}) });
    expect(post.status).toBe(308);
    expect(post.headers.get("location")).toBe("/api/attendance/punch");
    expect(await prisma.attendanceRecord.count()).toBe(before);
  });
});
