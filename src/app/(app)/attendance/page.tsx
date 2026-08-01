import { redirect } from "next/navigation";

import { EmployeeAttendanceRouteClient } from "@/features/attendance/components/EmployeePunchPage";
import { requireSession } from "@/lib/auth";

async function authorizeEmployeeAttendancePage() {
  const auth = await requireSession(["employee"]);
  if ("error" in auth) redirect("/dashboard");
  return auth.user;
}

export default async function AttendanceRoutePage() {
  await authorizeEmployeeAttendancePage();
  return <EmployeeAttendanceRouteClient />;
}
