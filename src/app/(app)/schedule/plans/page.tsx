import { redirect } from "next/navigation";

import SchedulePlansPage from "@/features/scheduling/components/SchedulePlansPage";
import { getSession } from "@/lib/auth";

export default async function Page() {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role === "employee") redirect("/dashboard");
  return <SchedulePlansPage initialStoreId={user.storeId} readOnly={user.role === "admin"} />;
}
