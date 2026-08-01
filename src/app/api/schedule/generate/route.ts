import { z } from "zod";

import { fail, ok, readJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { requireStoreAccess } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import {
  config,
  POSITIONS,
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
} from "@/lib/config";
import {
  localDateSchema,
  workModeSchema,
  type PositionDemand,
} from "@/lib/contracts/scheduling";
import { toDateStr, weekDays } from "@/lib/dates";
import { getForecastDetail, getStaffing } from "@/lib/forecast";
import { buildEmployeesWithUnavailable } from "@/lib/scheduleBuild";
import {
  engineHealthy,
  solveSchedule,
  type EnginePreference,
} from "@/lib/scheduleEngine";
import { getLLM } from "@/lib/llm";
import { scheduleExplainPrompt, scheduleParsePrompt } from "@/lib/prompts";
import {
  PlanDomainError,
  normalizePlanWeek,
  saveRecommendation,
} from "@/features/scheduling/server/plan-service";

const requestSchema = z
  .object({
    planId: z.string().min(1).optional(),
    storeId: z.string().min(1).optional(),
    weekOf: localDateSchema.optional(),
    instruction: z.string().trim().max(1000).optional(),
    version: z.number().int().min(0).optional(),
  })
  .refine((input) => input.planId || input.weekOf, "缺少 planId 或 weekOf");

async function resolvePlan(
  storeId: string,
  input: z.infer<typeof requestSchema>,
) {
  if (input.planId) {
    const plan = await prisma.schedulePlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new PlanDomainError("排班计划不存在", 404);
    if (plan.storeId !== storeId) {
      throw new PlanDomainError("无权操作其他门店的排班计划", 403);
    }
    return plan;
  }
  const weekOf = normalizePlanWeek(input.weekOf!);
  const existing = await prisma.schedulePlan.findUnique({
    where: { storeId_weekOf: { storeId, weekOf } },
  });
  if (!existing) throw new PlanDomainError("排班计划不存在", 404);
  return existing;
}

export async function POST(req: Request) {
  const auth = await requireSession(["manager"]);
  if ("error" in auth) return fail(auth.error, auth.status);
  const parsed = requestSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail("参数错误", 400, parsed.error.flatten());
  const access = await requireStoreAccess(["manager"], parsed.data.storeId);
  if ("error" in access) return fail(access.error, access.status);

  let plan: Awaited<ReturnType<typeof resolvePlan>>;
  try {
    plan = await resolvePlan(
      access.scope.storeId,
      parsed.data,
    );
  } catch (error) {
    if (error instanceof PlanDomainError) return fail(error.message, error.status);
    throw error;
  }
  if (plan.status === "published") {
    return fail("已发布计划不可重新生成推荐", 409);
  }
  const workMode = workModeSchema.safeParse(plan.mode);
  if (!workMode.success) return fail("排班计划工作制无效", 422);
  if (!(await engineHealthy())) {
    return fail("优化引擎不可用，可继续手动排班", 503);
  }

  const days = weekDays(plan.weekOf);
  const [baseEmployees, operatingDays, forecast, savedForecasts] = await Promise.all([
    buildEmployeesWithUnavailable(access.scope.storeId, plan.weekOf, days),
    prisma.storeOperatingDay.findMany({
      where: { storeId: access.scope.storeId },
      select: { dayOfWeek: true, isOpen: true },
    }),
    getForecastDetail(access.scope.storeId, days),
    prisma.trafficForecast.findMany({ where: { planId: plan.id } }),
  ]);
  const openByDay = new Map(
    operatingDays.map((day) => [day.dayOfWeek, day.isOpen]),
  );
  const closedDays = new Set(
    days.filter(
      (date) => openByDay.get(new Date(`${date}T00:00:00`).getDay()) === false,
    ),
  );
  const employees = baseEmployees.map((employee) => {
    const unavailable = new Map(
      (employee.unavailable ?? []).map((slot) => [
        `${slot.date}:${slot.shift}`,
        slot,
      ]),
    );
    for (const date of closedDays) {
      for (const shift of SHIFTS) {
        unavailable.set(`${date}:${shift}`, { date, shift });
      }
    }
    return { ...employee, unavailable: [...unavailable.values()] };
  });
  const savedByKey = new Map(
    savedForecasts.map((row) => [`${toDateStr(row.date)}_${row.timeSlot}`, row]),
  );
  const staffing = await getStaffing(
    access.scope.storeId,
    forecast.map((cell) => {
      const saved = savedByKey.get(`${cell.date}_${cell.shift}`);
      return {
        date: cell.date,
        shift: cell.shift,
        visitors: saved?.adjusted ?? saved?.predicted ?? cell.predicted,
      };
    }),
  );
  const demand: Record<string, Record<string, number>> = {};
  const positionDemand = {} as PositionDemand;
  for (const day of days) {
    demand[day] = {};
    positionDemand[day] = {} as PositionDemand[string];
    for (const shift of SHIFTS) {
      demand[day][shift] = 0;
      positionDemand[day][shift] = { cashier: 0, sales: 0 };
    }
  }
  for (const cell of staffing) {
    if (closedDays.has(cell.date)) continue;
    demand[cell.date][cell.shift] = cell.total;
    for (const position of POSITIONS) {
      positionDemand[cell.date][cell.shift][position] = cell.perPosition[position];
    }
  }

  const llm = getLLM();
  const instruction = parsed.data.instruction?.trim();
  let preferences: EnginePreference[] = [];
  let note = "";
  let parseLogPayload:
    | { inputText: string; outputText: string; provider?: string; model?: string }
    | undefined;
  if (instruction) {
    const system = scheduleParsePrompt({
      employees: employees.map((employee) => `${employee.id} - ${employee.name}`).join("\n"),
    });
    const parseResult = await llm.complete({
      system,
      user: instruction,
      model: config.llm.models.scheduleParse,
      feature: "schedule_parse",
      jsonMode: true,
      mockContext: {
        employees: employees.map((employee) => ({ id: employee.id, name: employee.name })),
      },
    });
    try {
      const decoded = JSON.parse(parseResult.text) as {
        preferences?: Array<{ employee_id?: string; shift?: string; weight?: string }>;
        note?: string;
      };
      const employeeIds = new Set(employees.map((employee) => employee.id));
      preferences = (decoded.preferences ?? [])
        .filter(
          (item): item is EnginePreference =>
            Boolean(item.employee_id) &&
            employeeIds.has(item.employee_id!) &&
            SHIFTS.includes(item.shift as Shift),
        )
        .map((item) => ({
          employee_id: item.employee_id,
          shift: item.shift,
          weight: item.weight || "soft",
        }));
      note = decoded.note ?? "";
    } catch {
      note = "未能解析诉求，已按默认需求排班";
    }
    parseLogPayload = {
      provider: parseResult.provider,
      model: parseResult.model,
      inputText: instruction,
      outputText: parseResult.text,
    };
  }

  let result;
  try {
    result = await solveSchedule({
      week_of: plan.weekOf,
      days,
      shifts: [...SHIFTS],
      demand,
      position_demand: positionDemand,
      employees,
      work_mode: workMode.data,
      shift_hours: config.scheduling.shiftHours,
      min_rest_hours: config.scheduling.minRestHours,
      max_weekly_hours: config.scheduling.maxWeeklyHours,
      preferences,
    });
  } catch {
    return fail("优化引擎不可用，可继续手动排班", 503);
  }
  if (result.status === "infeasible") {
    return fail(`优化引擎未找到可行解：${result.message}`, 422);
  }

  const nameById = new Map(employees.map((employee) => [employee.id, employee.name]));
  const assignments = result.assignments.map((assignment) => ({
    userId: assignment.employee_id,
    userName: nameById.get(assignment.employee_id) ?? assignment.employee_id,
    date: assignment.date,
    shiftType: assignment.shift,
  }));
  const resultSummary = assignments
    .map(
      (assignment) =>
        `${assignment.date} ${SHIFT_LABELS[assignment.shiftType]} ${assignment.userName}`,
    )
    .join("\n");
  const gapText = result.gaps.length
    ? result.gaps
        .map(
          (gap) =>
            `${gap.date} ${SHIFT_LABELS[gap.shift]} ${gap.position ?? "all"} 缺 ${gap.shortfall}`,
        )
        .join("\n")
    : "无缺口";
  const explainResult = await llm.complete({
    system: scheduleExplainPrompt({
      note: note || "（无特别诉求）",
      resultSummary: resultSummary || "（无排班）",
      gaps: gapText,
    }),
    user: "请解释这份排班结果。",
    model: config.llm.models.scheduleExplain,
    feature: "schedule_explain",
    mockContext: {
      note,
      totalAssignments: assignments.length,
      highlights: [],
      gaps: result.gaps,
    },
  });
  const explanation = explainResult.text;
  const explainLogPayload = {
    provider: explainResult.provider,
    model: explainResult.model,
    inputText: "解释排班结果",
    outputText: explanation,
  };
  const recommendation = {
    assignments,
    gaps: result.gaps,
    note,
    explanation,
    solveTimeMs: result.solve_time_ms,
    status: result.status,
  };
  try {
    const updatedPlan = await saveRecommendation(access.scope, {
      planId: plan.id,
      version: parsed.data.version ?? plan.version,
      recommendation,
      metric: {
        provider: explainResult.provider,
        model: explainResult.model,
        totalCells: employees.length * days.length,
      },
      rawLogs: {
        parse: parseLogPayload,
        explain: explainLogPayload,
      },
    });
    return ok({
      plan: updatedPlan,
      weekOf: plan.weekOf,
      ...recommendation,
      parseLogId: updatedPlan.parseLogId,
      aiLogId: updatedPlan.aiLogId,
    });
  } catch (error) {
    if (error instanceof PlanDomainError) return fail(error.message, error.status);
    throw error;
  }
}
