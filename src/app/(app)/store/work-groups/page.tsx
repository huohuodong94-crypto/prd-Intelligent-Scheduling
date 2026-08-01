import { redirect } from "next/navigation";

import WorkGroupsPage from "@/features/store/components/WorkGroupsPage";
import { getWorkforceOptions, listWorkGroups } from "@/features/store/server/workforce-service";
import { listStoreOptions } from "@/features/store/server/store-service";
import { getSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams?: { storeId?: string } }) {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role === "employee") redirect("/dashboard");
  const storeOptions = await listStoreOptions(user);
  if (!storeOptions.length) redirect("/dashboard");
  const requested = searchParams?.storeId;
  const storeId = requested && storeOptions.some((store) => store.id === requested)
    ? requested
    : user.storeId ?? storeOptions[0].id;
  const scope = { user, storeId };
  const [initialGroups, options] = await Promise.all([
    listWorkGroups(scope),
    getWorkforceOptions(scope),
  ]);
  return <WorkGroupsPage storeId={storeId} readOnly={user.role === "admin"} initialGroups={initialGroups} {...options} />;
}
