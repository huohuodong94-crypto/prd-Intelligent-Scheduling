import { clearSession } from "@/lib/auth";
import { ok } from "@/lib/api";

export async function POST() {
  clearSession();
  return ok({});
}
