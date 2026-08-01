import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ok, fail } from "@/lib/api";
import { AttendanceServiceError, listOwnPunches } from "@/features/attendance/server/attendance-service";

// 旧写入口只返回迁移指引，绝不写库。
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "请使用 /api/attendance/punch", details: { location: "/api/attendance/punch" } },
    { status: 308, headers: { Location: "/api/attendance/punch" } },
  );
}

// 查询本人打卡记录
export async function GET() {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  try { return ok(await listOwnPunches(auth.user)); }
  catch (error) {
    if (error instanceof AttendanceServiceError) return fail(error.message, error.status);
    throw error;
  }
}
