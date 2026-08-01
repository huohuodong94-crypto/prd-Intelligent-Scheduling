import { redirect } from "next/navigation";

import ScheduleWizardPage from "@/features/scheduling/components/ScheduleWizardPage";
import { getSession } from "@/lib/auth";

export default async function Page({ params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role === "employee") redirect("/dashboard");
  return <ScheduleWizardPage planId={params.id} readOnly={user.role === "admin"} />;
}
