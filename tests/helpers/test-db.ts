import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function resetTestDb(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'"
    );
    for (const table of tables)
      await prisma.$executeRawUnsafe(`DELETE FROM "${table.name.replaceAll('"', '""')}"`);
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
}
