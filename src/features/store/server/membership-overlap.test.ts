import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { dateRangesOverlap } from "./membership-overlap";
import { mapWorkforceConcurrencyError } from "./workforce-service";

describe("dateRangesOverlap", () => {
  it("treats an open end date as infinity", () => {
    expect(
      dateRangesOverlap(
        new Date("2026-07-01T00:00:00.000Z"),
        null,
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-08-31T00:00:00.000Z")
      )
    ).toBe(true);
  });

  it("treats both inclusive endpoints on the same day as overlapping", () => {
    const day = new Date("2026-07-31T00:00:00.000Z");
    expect(dateRangesOverlap(day, day, day, day)).toBe(true);
  });

  it("accepts adjacent ranges that do not share a calendar day", () => {
    expect(
      dateRangesOverlap(
        new Date("2026-07-01T00:00:00.000Z"),
        new Date("2026-07-31T00:00:00.000Z"),
        new Date("2026-08-01T00:00:00.000Z"),
        null
      )
    ).toBe(false);
  });
});

describe("workforce concurrency error mapping", () => {
  it.each(["P1008", "P2002", "P2028", "P2034"])("maps Prisma %s to domain 409", (code) => {
    const error = new Prisma.PrismaClientKnownRequestError("write race", {
      code,
      clientVersion: Prisma.prismaVersion.client,
    });
    expect(mapWorkforceConcurrencyError(error, "并发冲突")).toMatchObject({
      status: 409,
      message: "并发冲突",
    });
  });
});
