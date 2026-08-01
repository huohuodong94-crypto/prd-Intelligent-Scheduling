import { redirect } from "next/navigation";

import { PunchesRouteClient } from "@/features/attendance/components/PunchesPage";
import type { AttendanceRole } from "@/features/attendance/components/DailyAttendancePage";
import { requireSession } from "@/lib/auth";

async function authorizePunchesPage() {
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth || (auth.user.role === "manager" && !auth.user.storeId)) redirect("/dashboard");
  return auth.user;
}

export default async function PunchesRoutePage() {
  const user = await authorizePunchesPage();
  return <PunchesRouteClient role={user.role as AttendanceRole} initialStoreId={user.role === "manager" ? user.storeId ?? "" : ""} />;
}
