import { redirect } from "next/navigation";

import MonthlyReportPage from "@/features/reports/components/MonthlyReportPage";
import { requireSession } from "@/lib/auth";

export default async function MonthlyReportRoutePage() {
  const auth = await requireSession(["manager", "admin"]);
  if ("error" in auth || (auth.user.role === "manager" && !auth.user.storeId)) redirect("/dashboard");
  return <MonthlyReportPage role={auth.user.role as "manager" | "admin"} initialStoreId={auth.user.role === "manager" ? auth.user.storeId ?? "" : ""} />;
}
