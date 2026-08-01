// 集中读取环境变量，提供默认值。模型名/约束参数均可配置，不写死在业务逻辑里。

export const DEFAULT_CLOCK_CODE_SECRET = "replace-with-a-long-random-secret";

export class ClockCodeConfigurationError extends Error {
  constructor() {
    super("动态码服务配置错误");
    this.name = "ClockCodeConfigurationError";
  }
}

export function getClockCodeSecret(options: { nodeEnv?: string; secret?: string } = {}): string {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const secret = (options.secret ?? process.env.CLOCK_CODE_SECRET ?? "").trim();
  if (nodeEnv === "production" && (!secret || secret === DEFAULT_CLOCK_CODE_SECRET)) throw new ClockCodeConfigurationError();
  return secret || DEFAULT_CLOCK_CODE_SECRET;
}

export function getAttendanceNow(): Date {
  const fixed = process.env.WFM_E2E_NOW;
  if (fixed) {
    const value = new Date(fixed);
    if (!Number.isNaN(value.getTime())) return value;
  }
  return new Date();
}

export const config = {
  auth: {
    secret: process.env.AUTH_SECRET || "dev-secret-change-me",
    fixedOtp: process.env.FIXED_OTP_CODE || "123456",
  },
  attendance: {
    clockCodeSecret: process.env.CLOCK_CODE_SECRET || DEFAULT_CLOCK_CODE_SECRET,
  },
  llm: {
    provider: (process.env.LLM_PROVIDER || "mock").toLowerCase(), // mock | deepseek | anthropic
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    models: {
      assistant: process.env.LLM_MODEL_ASSISTANT || "deepseek-chat",
      scheduleParse: process.env.LLM_MODEL_SCHEDULE_PARSE || "deepseek-chat",
      auditCheck: process.env.LLM_MODEL_AUDIT_CHECK || "deepseek-chat",
      scheduleExplain: process.env.LLM_MODEL_SCHEDULE_EXPLAIN || "deepseek-chat",
      swapCheck: process.env.LLM_MODEL_SWAP_CHECK || "deepseek-chat",
    },
  },
  embedding: {
    provider: (process.env.EMBEDDING_PROVIDER || "local").toLowerCase(), // local | openai
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  },
  engine: {
    url: process.env.SCHEDULE_ENGINE_URL || "http://localhost:8000",
  },
  scheduling: {
    maxWeeklyHours: Number(process.env.MAX_WEEKLY_HOURS || 40),
    // 决策 D3：休息间隔默认 4 小时，使「早班 + 晚班」同日组合成为合法解
    minRestHours: Number(process.env.MIN_REST_HOURS || 4),
    shiftHours: Number(process.env.SHIFT_HOURS || 4),
    // 新员工阈值（月）：入职时长 ≤ 该值视为新员工，用于新老搭班规则
    seniorityMonths: Number(process.env.SENIORITY_MONTHS || 6),
  },
};

export const SHIFTS = ["morning", "afternoon", "evening"] as const;
export type Shift = (typeof SHIFTS)[number];

export const SHIFT_LABELS: Record<Shift, string> = {
  morning: "早班 09:00-13:00",
  afternoon: "午班 13:00-17:00",
  evening: "晚班 17:00-21:00",
};

export const SHIFT_TIMES: Record<Shift, { start: number; end: number }> = {
  morning: { start: 9, end: 13 },
  afternoon: { start: 13, end: 17 },
  evening: { start: 17, end: 21 },
};

// 岗位（两层模型的第二层）：店长/管理员无岗位，不参与排班
export const POSITIONS = ["cashier", "sales"] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<Position, string> = {
  cashier: "收银",
  sales: "销售",
};
