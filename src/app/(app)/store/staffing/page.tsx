import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import StaffingPage from "@/features/store/components/StaffingPage";
import {
  getStaffingRows,
  listStoreOptions,
} from "@/features/store/server/store-service";

export default async function Page({
  searchParams,
}: {
  searchParams?: { storeId?: string };
}) {
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role === "employee") redirect("/dashboard");

  const storeOptions = await listStoreOptions(user);
  if (storeOptions.length === 0) redirect("/dashboard");
  const requested = searchParams?.storeId;
  const selectedStoreId =
    requested && storeOptions.some((store) => store.id === requested)
      ? requested
      : user.storeId ?? storeOptions[0].id;
  const initialRows = await getStaffingRows({ user, storeId: selectedStoreId });

  return (
    <StaffingPage
      sessionStoreId={user.storeId}
      readOnly={user.role === "admin"}
      storeOptions={storeOptions}
      initialStoreId={selectedStoreId}
      initialRows={initialRows}
    />
  );
}
