import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

const { mockClient, ordinaryMethod, prismaClientConstructor } = vi.hoisted(() => {
  const ordinaryMethod = vi.fn(function (this: unknown) {
    return this;
  });
  const mockClient = {
    user: { findUnique: vi.fn() },
    ordinaryMethod,
  };
  const prismaClientConstructor = vi.fn(function () {
    return mockClient;
  });
  return { mockClient, ordinaryMethod, prismaClientConstructor };
});

vi.mock("@prisma/client", () => ({
  PrismaClient: prismaClientConstructor,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (globalThis as { prisma?: unknown }).prisma;
});

it("does not construct PrismaClient when the db module is imported", async () => {
  const db = await import("./db");
  const prisma: PrismaClientType = db.prisma;

  expect(prisma).toBeDefined();
  expect(prismaClientConstructor).not.toHaveBeenCalled();
});

it("constructs one client on first property access and reuses it", async () => {
  const { prisma } = await import("./db");
  const proxy = prisma as unknown as { user: typeof mockClient.user };

  expect(prismaClientConstructor).not.toHaveBeenCalled();
  expect(proxy.user).toBe(mockClient.user);
  expect(prismaClientConstructor).toHaveBeenCalledTimes(1);
  expect(proxy.user).toBe(mockClient.user);
  expect(prismaClientConstructor).toHaveBeenCalledTimes(1);
});

it("binds ordinary methods to the real singleton client", async () => {
  const { prisma } = await import("./db");
  const proxy = prisma as unknown as { ordinaryMethod: () => unknown };

  expect(proxy.ordinaryMethod()).toBe(mockClient);
  expect(ordinaryMethod).toHaveBeenCalledTimes(1);
  expect(ordinaryMethod.mock.contexts[0]).toBe(mockClient);
  expect(prismaClientConstructor).toHaveBeenCalledTimes(1);
});
