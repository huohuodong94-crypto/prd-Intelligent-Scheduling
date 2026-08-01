import { redirect } from "next/navigation";

import { DailyAttendanceRouteClient, type AttendanceRole } from "@/features/attendance/components/DailyAttendancePage";
import { requireSession } from "@/lib/auth";

async function authorizeDailyAttendancePage() {
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth || (auth.user.role === "manager" && !auth.user.storeId)) redirect("/dashboard");
  return auth.user;
}

export default async function DailyAttendanceRoutePage() {
  const user = await authorizeDailyAttendancePage();
  return <DailyAttendanceRouteClient role={user.role as AttendanceRole} initialStoreId={user.role === "manager" ? user.storeId ?? "" : ""} />;
}
