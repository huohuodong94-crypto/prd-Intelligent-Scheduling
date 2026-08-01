import { redirect } from "next/navigation";

import SchedulingReportPage from "@/features/reports/components/SchedulingReportPage";
import { requireSession } from "@/lib/auth";

export default async function SchedulingReportRoutePage() {
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth || (auth.user.role === "manager" && !auth.user.storeId)) redirect("/dashboard");
  return <SchedulingReportPage role={auth.user.role as "manager" | "admin"} initialStoreId={auth.user.role === "manager" ? auth.user.storeId ?? "" : ""} />;
}
