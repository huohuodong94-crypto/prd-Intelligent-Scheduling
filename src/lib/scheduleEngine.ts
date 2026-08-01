import { config, type Position, type Shift } from "./config";
import type { PositionDemand, WorkMode } from "./contracts/scheduling";
import { solveDemoSchedule } from "./demoScheduleSolver";

// 排班优化引擎（Python OR-Tools 服务）的 HTTP 客户端。
// Node 后端唯一通过该客户端调用求解，绝不在 Node/LLM 侧做排班计算。

export type EnginePreference = {
  employee_id: string;
  shift: Shift;
  weight: string;
};

export type EngineEmployee = {
  id: string;
  name: string;
  position: Position;
  max_weekly_hours?: number;
  last_week_hours?: number;
  unavailable?: Array<{ date: string; shift: Shift }>;
};

export type SolveRequest = {
  week_of: string;
  days: string[];
  shifts?: Shift[];
  demand: Record<string, Record<string, number>>;
  position_demand: PositionDemand;
  employees: EngineEmployee[];
  work_mode: WorkMode;
  shift_hours?: number;
  min_rest_hours?: number;
  max_weekly_hours?: number;
  preferences?: EnginePreference[];
};

export type SolveResult = {
  status: "feasible" | "feasible_with_gaps" | "infeasible";
  message: string;
  objective?: number;
  solve_time_ms?: number;
  assignments: Array<{ employee_id: string; date: string; shift: Shift }>;
  gaps: Array<{
    date: string;
    shift: Shift;
    position?: Position;
    required: number;
    shortfall: number;
  }>;
};

function shouldUseDemoEngine() {
  return (
    process.env.VERCEL === "1" ||
    process.env.SCHEDULE_ENGINE_MODE === "demo" ||
    config.engine.url === "demo"
  );
}

export async function solveSchedule(req: SolveRequest): Promise<SolveResult> {
  if (shouldUseDemoEngine()) return solveDemoSchedule(req);
  const res = await fetch(`${config.engine.url}/solve-schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    // 求解可能稍慢，给足超时
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`优化引擎调用失败 (${res.status}): ${text}`);
  }
  return (await res.json()) as SolveResult;
}

export async function engineHealthy(): Promise<boolean> {
  if (shouldUseDemoEngine()) return true;
  try {
    const res = await fetch(`${config.engine.url}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
