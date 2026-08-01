import { redirect } from "next/navigation";

import { ClockCodeRouteClient } from "@/features/attendance/components/ClockCodePage";
import { requireSession } from "@/lib/auth";

async function authorizeClockCodePage() {
  const auth = await requireSession(["manager"]);
  if ("error" in auth || !auth.user.storeId) redirect("/dashboard");
  return auth.user;
}

export default async function ClockCodeRoutePage() {
  await authorizeClockCodePage();
  return <ClockCodeRouteClient />;
}
