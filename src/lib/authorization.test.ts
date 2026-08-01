import { describe, expect, it } from "vitest";
import { resolveStoreAccess } from "./authorization";
import type { SessionUser } from "./auth";

const manager: SessionUser = {
  id: "manager-a",
  name: "李经理",
  role: "manager",
  storeId: "store-a",
  phone: "13800000001",
};

const storeBoundAdmin: SessionUser = {
  id: "admin-a",
  name: "管理员",
  role: "admin",
  storeId: "store-a",
  phone: "13800000002",
};

describe("resolveStoreAccess", () => {
  it("rejects a manager requesting another store", () => {
    expect(resolveStoreAccess(manager, "store-b")).toEqual({
      error: "无权访问其他门店",
      status: 403,
    });
  });

  it("uses the manager session store when storeId is omitted", () => {
    expect(resolveStoreAccess(manager, null)).toEqual({
      user: manager,
      storeId: "store-a",
    });
  });

  it("requires an explicit store for admins when the caller opts into report scope", () => {
    expect(resolveStoreAccess(storeBoundAdmin, null, { adminRequiresExplicitStore: true })).toEqual({
      error: "管理员必须显式指定门店",
      status: 400,
    });
    expect(resolveStoreAccess(storeBoundAdmin, "store-a", { adminRequiresExplicitStore: true })).toEqual({
      user: storeBoundAdmin,
      storeId: "store-a",
    });
    expect(resolveStoreAccess(storeBoundAdmin, null)).toEqual({
      user: storeBoundAdmin,
      storeId: "store-a",
    });
  });
});
