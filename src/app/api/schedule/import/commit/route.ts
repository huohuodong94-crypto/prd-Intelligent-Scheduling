import { z } from "zod";
import { fail, ok, readJson } from "@/lib/api";
import { requireStoreAccess } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import {
  commitImport,
  createFailingScheduleWriterFactory,
  e2eImportFailureRow,
  ScheduleCommandError,
} from "@/features/scheduling/server/schedule-command-service";

const schema = z.object({ batchId: z.string().min(1), version: z.number().int().nonnegative() });

export async function POST(request: Request) {
  const access = await requireStoreAccess(["manager"]);
  if ("error" in access) return fail(access.error, access.status);
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  try {
    const batch = await prisma.scheduleImportBatch.findUnique({
      where: { id: parsed.data.batchId },
      select: { fileName: true },
    });
    const failureRow = e2eImportFailureRow(batch?.fileName ?? "");
    return ok(await commitImport(
      access.scope,
      parsed.data,
      failureRow ? createFailingScheduleWriterFactory(failureRow) : undefined,
    ));
  } catch (error) {
    if (error instanceof ScheduleCommandError) return fail(error.message, error.status, { code: error.code, issues: error.issues });
    throw error;
  }
}
