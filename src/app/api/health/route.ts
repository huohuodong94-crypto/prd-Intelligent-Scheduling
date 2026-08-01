import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [storeCount, userCount, ruleCount, trafficCount] = await Promise.all([
      prisma.store.count(),
      prisma.user.count(),
      prisma.ruleChunk.count(),
      prisma.trafficRecord.count(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        data: {
          status: "healthy",
          demoMode:
            process.env.VERCEL === "1" || process.env.WFM_DEMO_MODE === "1",
          database: "ready",
          counts: {
            stores: storeCount,
            users: userCount,
            schedulingRules: ruleCount,
            trafficForecasts: trafficCount,
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json(
      { ok: false, error: "Service unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
