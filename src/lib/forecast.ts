import { prisma } from "./db";
import { SHIFTS, POSITIONS, type Shift, type Position } from "./config";
import { toDateStr } from "./dates";

// 预测层：历史客流 → 基线预测 → V2S 折算 → 各岗位人力需求。
// 算法为 PRD §4.2/§4.3 的可解释基线模型；接口保持抽象，
// TODO(ML): 后续可整体替换为时序模型，调用方无需改动。

export type DemandForecast = {
  // key: "YYYY-MM-DD" -> { morning, afternoon, evening }
  [date: string]: Record<Shift, number>;
};

// 单格客流预测的可解释明细（Step 2/3 展示折算依据用）
export type ForecastCell = {
  date: string;
  shift: Shift;
  predicted: number; // 模型预测值
  mean4w: number; // 近 4 周同星期几同班次均值
  lastWeek: number; // 上周同星期几同班次
  eventFactor: number; // 活动系数
};

// 各岗位人力需求（PRD §4.3）
export type StaffingCell = {
  date: string;
  shift: Shift;
  visitors: number; // 采用的客流值（人工调整后优先）
  total: number; // 折算后的总人力
  perPosition: Record<Position, number>;
  v2sLower: number;
  v2sUpper: number;
  minTotal: number; // 最低人力兜底合计
  clampedBy: "min" | "upper" | "none"; // 命中哪一侧边界，供 UI 说明
};

const DAY_MS = 24 * 3600 * 1000;

// 读取门店活动系数：storeId + 日期 -> factor（无活动为 1.0）
async function getEventFactors(
  storeId: string,
  dates: string[]
): Promise<Map<string, number>> {
  const events = await prisma.storeEvent.findMany({
    where: {
      storeId,
      date: {
        gte: new Date(dates[0] + "T00:00:00"),
        lte: new Date(dates[dates.length - 1] + "T23:59:59"),
      },
    },
  });
  const map = new Map<string, number>();
  for (const e of events) {
    // 同日多活动取最大系数，避免连乘放大
    const k = toDateStr(e.date);
    map.set(k, Math.max(map.get(k) ?? 1, e.factor));
  }
  return map;
}

// PRD §4.2：forecast(d,s) = [0.6×mean(近4周同星期几同班次) + 0.4×上周同星期几同班次] × event(d)
export async function getForecastDetail(
  storeId: string,
  dates: string[]
): Promise<ForecastCell[]> {
  const first = new Date(dates[0] + "T00:00:00");
  // 取计划周之前 4 周的历史客流
  const histStart = new Date(first.getTime() - 28 * DAY_MS);
  const history = await prisma.trafficRecord.findMany({
    where: { storeId, date: { gte: histStart, lt: first } },
  });

  // 按 (星期几_班次) 归集历史值，并记录距离计划周的周数（1=上周）
  const byKey = new Map<string, Array<{ weeksAgo: number; visitors: number }>>();
  for (const r of history) {
    const dow = r.date.getDay();
    const weeksAgo = Math.ceil((first.getTime() - r.date.getTime()) / (7 * DAY_MS));
    const k = `${dow}_${r.timeSlot}`;
    const arr = byKey.get(k) ?? [];
    arr.push({ weeksAgo, visitors: r.visitors });
    byKey.set(k, arr);
  }

  const eventFactors = await getEventFactors(storeId, dates);
  const cells: ForecastCell[] = [];
  for (const date of dates) {
    const dow = new Date(date + "T00:00:00").getDay();
    const eventFactor = eventFactors.get(date) ?? 1.0;
    for (const shift of SHIFTS) {
      const samples = byKey.get(`${dow}_${shift}`) ?? [];
      const mean4w =
        samples.length > 0
          ? samples.reduce((s, x) => s + x.visitors, 0) / samples.length
          : 0;
      const lastWeekSample = samples.find((x) => x.weeksAgo === 1);
      // 上周缺样本时退化为均值，避免整格塌成 0
      const lastWeek = lastWeekSample ? lastWeekSample.visitors : mean4w;
      const predicted = (0.6 * mean4w + 0.4 * lastWeek) * eventFactor;
      cells.push({
        date,
        shift,
        predicted: Math.round(predicted * 100) / 100,
        mean4w: Math.round(mean4w * 100) / 100,
        lastWeek: Math.round(lastWeek * 100) / 100,
        eventFactor,
      });
    }
  }
  return cells;
}

// PRD §4.3 人力折算。visitorsByKey 传入「采用的客流」（Step 2 人工调整后的值优先）
export async function getStaffing(
  storeId: string,
  cells: Array<{ date: string; shift: Shift; visitors: number }>
): Promise<StaffingCell[]> {
  const [v2s, minStaffing] = await Promise.all([
    prisma.v2SConfig.findMany({ where: { storeId } }),
    prisma.minStaffingConfig.findMany({ where: { storeId } }),
  ]);
  const v2sByDow = new Map(v2s.map((c) => [c.dayOfWeek, c]));
  const minByKey = new Map(
    minStaffing.map((c) => [`${c.dayOfWeek}_${c.timeSlot}_${c.position}`, c.minHeadcount])
  );

  return cells.map(({ date, shift, visitors }) => {
    const dow = new Date(date + "T00:00:00").getDay();
    const cfg = v2sByDow.get(dow);
    // 无 V2S 配置时退化为「仅最低人力」，不让整页崩掉
    const v2sLower = cfg?.v2sLower ?? 0;
    const v2sUpper = cfg?.v2sUpper ?? 0;

    const perMin = {} as Record<Position, number>;
    for (const p of POSITIONS) perMin[p] = minByKey.get(`${dow}_${shift}_${p}`) ?? 0;
    const minTotal = POSITIONS.reduce((s, p) => s + perMin[p], 0);

    // 总人力 = clamp(ceil(客流/上界), 下界=Σ最低人力, 上界=ceil(客流/下界))
    const byUpper = v2sUpper > 0 ? Math.ceil(visitors / v2sUpper) : 0;
    const byLower = v2sLower > 0 ? Math.ceil(visitors / v2sLower) : minTotal;
    let total = byUpper;
    let clampedBy: StaffingCell["clampedBy"] = "none";
    if (total < minTotal) {
      total = minTotal;
      clampedBy = "min";
    } else if (total > byLower) {
      total = byLower;
      clampedBy = "upper";
    }

    // 收银按最低配置固定；销售吃掉剩余需求（但不低于其最低人力）
    const perPosition = {} as Record<Position, number>;
    perPosition.cashier = perMin.cashier;
    perPosition.sales = Math.max(perMin.sales, total - perMin.cashier);

    return {
      date,
      shift,
      visitors,
      total: perPosition.cashier + perPosition.sales,
      perPosition,
      v2sLower,
      v2sUpper,
      minTotal,
      clampedBy,
    };
  });
}

// 排班引擎的人数需求入口（保持一期抽象不变）。
// 优先采用该计划周已保存的预测（含人工调整），无计划时用实时基线预测。
export async function getDemandForecast(
  storeId: string,
  dates: string[],
  planId?: string
): Promise<DemandForecast> {
  let visitorCells: Array<{ date: string; shift: Shift; visitors: number }> = [];

  if (planId) {
    const saved = await prisma.trafficForecast.findMany({ where: { planId } });
    if (saved.length > 0) {
      visitorCells = saved.map((f) => ({
        date: toDateStr(f.date),
        shift: f.timeSlot as Shift,
        visitors: f.adjusted ?? f.predicted, // 人工调整值优先
      }));
    }
  }
  if (visitorCells.length === 0) {
    const detail = await getForecastDetail(storeId, dates);
    visitorCells = detail.map((c) => ({
      date: c.date,
      shift: c.shift,
      visitors: c.predicted,
    }));
  }

  const staffing = await getStaffing(storeId, visitorCells);
  const result: DemandForecast = {};
  for (const date of dates) {
    result[date] = {} as Record<Shift, number>;
    for (const s of SHIFTS) result[date][s] = 0;
  }
  for (const c of staffing) {
    if (result[c.date]) result[c.date][c.shift] = c.total;
  }
  return result;
}
