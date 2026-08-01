import { readFileSync } from "fs";
import { join } from "path";

// 从 /prompts 目录加载 system prompt 模板，并填充占位符。
// prompt 与业务代码解耦，可单独迭代某个 prompt 而不动代码。

const PROMPT_DIR = join(process.cwd(), "prompts");

function loadTemplate(file: string): string {
  return readFileSync(join(PROMPT_DIR, file), "utf-8");
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function assistantPrompt(vars: {
  role: string;
  allowedFeatures: string;
  ruleChunks: string;
}): string {
  return fill(loadTemplate("assistant.md"), vars);
}

export function scheduleParsePrompt(vars: { employees: string }): string {
  return fill(loadTemplate("schedule_parse.md"), vars);
}

export function scheduleExplainPrompt(vars: {
  note: string;
  resultSummary: string;
  gaps: string;
}): string {
  return fill(loadTemplate("schedule_explain.md"), vars);
}

export function auditCompliancePrompt(vars: {
  ruleChunks: string;
  approvalType: string;
  approvalDetail: string;
}): string {
  return fill(loadTemplate("audit_compliance.md"), vars);
}

// 角色 → 可访问功能范围（注入到助手 prompt 的权限边界）
export const ROLE_FEATURES: Record<string, string> = {
  employee: "打卡、请假申请（年假/病假）、查看个人年假余额、AI 助手问答、基础报表查看",
  manager:
    "打卡、请假审批、排班管理（含 AI 智能排班推荐）、门店报表、AI 助手问答",
  admin: "门店与需求配置、全部报表、用户管理、AI 助手问答",
};

export const ROLE_LABELS: Record<string, string> = {
  employee: "店铺员工",
  manager: "店铺经理",
  admin: "系统管理员",
};
