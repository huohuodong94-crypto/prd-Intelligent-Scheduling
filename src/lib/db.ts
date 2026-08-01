import { PrismaClient } from "@prisma/client";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function prepareDemoDatabase() {
  const demoMode = process.env.VERCEL === "1" || process.env.WFM_DEMO_MODE === "1";
  if (!demoMode) return;

  const template =
    process.env.WFM_DEMO_DATABASE_TEMPLATE || join(process.cwd(), "prisma", "demo.db");
  const target = process.env.WFM_DEMO_DATABASE_PATH || join("/tmp", "wfm-demo.db");

  if (!existsSync(target)) {
    if (!existsSync(template)) {
      throw new Error(`演示数据库模板不存在: ${template}`);
    }
    copyFileSync(template, target);
  }
  process.env.DATABASE_URL = `file:${target}`;
}

prepareDemoDatabase();

// 全局单例，避免开发热重载时创建过多连接
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let prismaClient = globalForPrisma.prisma;

function getPrismaClient(): PrismaClient {
  if (prismaClient) return prismaClient;

  prismaClient = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prismaClient;
  return prismaClient;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
