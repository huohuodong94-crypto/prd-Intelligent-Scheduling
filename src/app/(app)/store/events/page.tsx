import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { dateToDateOnly, monthOnlySchema } from "@/lib/contracts/store";
import EventsPage from "@/features/store/components/EventsPage";
import { getStoreEvents, listStoreOptions } from "@/features/store/server/store-service";

export default async function Page({
  searchParams,
}: {
  searchParams?: { storeId?: string; month?: string; year?: string };
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
  const currentMonth = dateToDateOnly(new Date()).slice(0, 7);
  const parsedMonth = monthOnlySchema.safeParse(searchParams?.month);
  const initialMonth = parsedMonth.success ? parsedMonth.data : currentMonth;
  const requestedYear = Number(searchParams?.year);
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100
      ? requestedYear
      : Number(initialMonth.slice(0, 4));
  const initialEvents = await getStoreEvents(
    { user, storeId: selectedStoreId },
    user.role === "admin" ? { year } : { month: initialMonth }
  );

  return (
    <EventsPage
      sessionStoreId={user.storeId}
      readOnly={user.role === "admin"}
      storeOptions={storeOptions}
      initialStoreId={selectedStoreId}
      initialMonth={user.role === "admin" ? `${year}-01` : initialMonth}
      initialEvents={initialEvents}
    />
  );
}
