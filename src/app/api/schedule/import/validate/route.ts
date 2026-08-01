import { fail, ok } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { ScheduleCommandError, validateImportFile } from "@/features/scheduling/server/schedule-command-service";

export const runtime = "nodejs";
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  const form = await request.formData();
  const file = form.get("file");
  const planId = String(form.get("planId") ?? "");
  const rawVersion = form.get("version");
  const version = typeof rawVersion === "string" && rawVersion.trim() !== ""
    ? Number(rawVersion)
    : Number.NaN;
  if (!(file instanceof File) || !planId || !Number.isInteger(version) || version < 0) return fail("缺少文件、计划或版本", 400);
  if (!file.name.toLowerCase().endsWith(".xlsx")) return fail("仅支持 .xlsx 文件", 400);
  if (file.size > MAX_BYTES) return fail("文件不得超过 5 MiB", 413);
  try {
    return ok(await validateImportFile(access.scope, { planId, version, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) }));
  } catch (error) {
    if (error instanceof ScheduleCommandError) return fail(error.message, error.status, { code: error.code, issues: error.issues });
    return fail("表格文件（.xlsx）无法解析", 400);
  }
}
