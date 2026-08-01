import { redirect } from "next/navigation";

import { MonthlyAttendanceRouteClient } from "@/features/attendance/components/MonthlyAttendancePage";
import { requireSession } from "@/lib/auth";

export default async function MonthlyAttendanceRoutePage() {
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth || (auth.user.role === "manager" && !auth.user.storeId)) redirect("/dashboard");
  return <MonthlyAttendanceRouteClient role={auth.user.role as "manager" | "admin"} initialStoreId={auth.user.role === "manager" ? auth.user.storeId ?? "" : ""} />;
}
