import type { LLMProvider, LLMRequest, LLMResponse } from "./provider";

// 降级实现：无需 API Key，给出确定性、可用的输出，让全链路可跑通、可演示。
// 逻辑基于 mockContext 中的结构化数据，而非从 prompt 文本里猜，因此结果稳定正确。
// 填入真实 Key 并将 LLM_PROVIDER 切到 anthropic 后即用真实模型替换本实现。
export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async complete(req: LLMRequest): Promise<LLMResponse> {
    // provider/model 一律回报 mock：埋点据此如实记录降级事实，不写 req.model
    return { text: this.textFor(req), provider: this.name, model: "mock" };
  }

  private textFor(req: LLMRequest): string {
    switch (req.feature) {
      case "assistant":
        return this.assistant(req);
      case "schedule_parse":
        return this.scheduleParse(req);
      case "audit_check":
        return this.auditCheck(req);
      case "schedule_explain":
        return this.scheduleExplain(req);
      default:
        return "（mock）暂不支持的功能。";
    }
  }

  private assistant(req: LLMRequest): string {
    const q = req.user || "";
    // 页面跳转意图识别
    const navMap: Array<[RegExp, string]> = [
      [/打卡|签到/, "/attendance"],
      [/请假|年假|病假申请|休假/, "/leave"],
      [/审批|待审/, "/approvals"],
      [/排班/, "/schedule"],
      [/报表|工时汇总/, "/reports"],
    ];
    if (/去|打开|跳转|进入/.test(q)) {
      for (const [re, target] of navMap) {
        if (re.test(q)) return JSON.stringify({ action: "navigate", target });
      }
    }
    // 基于 RAG 检索片段作答（mockContext.chunks 为已检索到的规则片段）
    const chunks = (req.mockContext?.chunks as Array<{ title: string; content: string }>) || [];
    if (chunks.length === 0) {
      return "抱歉，规则库中暂未找到相关依据，建议联系店铺经理或系统管理员确认。";
    }
    const balance = req.mockContext?.leaveBalance as
      | { annual: number; sick: number }
      | undefined;
    if (/还有多少年假|年假.*余额|剩.*年假/.test(q) && balance) {
      return `根据系统记录，你当前的年假余额约为 ${balance.annual} 小时（约 ${(balance.annual / 8).toFixed(1)} 天）。如需申请，请前往「请假」页面提交。`;
    }
    // 取最相关片段前 120 字作答
    const top = chunks[0];
    const snippet = top.content.replace(/\s+/g, "").slice(0, 120);
    return `${snippet}（依据：${top.title}）如需进一步确认，请联系店铺经理。`;
  }

  private scheduleParse(req: LLMRequest): string {
    const text = req.user || "";
    const employees =
      (req.mockContext?.employees as Array<{ id: string; name: string }>) || [];
    const shiftKeywords: Array<[RegExp, string]> = [
      [/早班|早上|上午/, "morning"],
      [/午班|中班|下午|午/, "afternoon"],
      [/晚班|晚上|夜/, "evening"],
    ];
    let shift: string | null = null;
    for (const [re, s] of shiftKeywords) {
      if (re.test(text)) {
        shift = s;
        break;
      }
    }
    const preferences: Array<{ employee_id: string; shift: string; weight: string }> = [];
    if (shift) {
      for (const e of employees) {
        // 姓名或姓名去掉“小”“老”前缀后出现在诉求里
        const bare = e.name.replace(/^[小老阿]/, "");
        if (text.includes(e.name) || (bare && text.includes(bare))) {
          preferences.push({ employee_id: e.id, shift, weight: "soft" });
        }
      }
    }
    const note =
      preferences.length > 0
        ? `已识别：为 ${preferences
            .map((p) => employees.find((e) => e.id === p.employee_id)?.name)
            .join("、")} 增加${shiftLabel(shift!)}偏好`
        : "未识别到明确的排班偏好";
    return JSON.stringify({ preferences, note });
  }

  private auditCheck(req: LLMRequest): string {
    const approvalType = req.mockContext?.approvalType as string | undefined;
    if (approvalType === "punch_correction") {
      const correction = req.mockContext?.correction as
        | { date?: string; requestedTime?: string; reason?: string }
        | undefined;
      const requested = correction?.requestedTime ? new Date(correction.requestedTime) : null;
      const localDate = requested
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(requested)
        : null;
      if (!correction?.reason || !requested || Number.isNaN(requested.getTime()) || localDate !== correction.date) {
        return JSON.stringify({ suggestion: "suspicious", reason: "补卡日期、时间或原因不完整，建议人工核实。" });
      }
      return JSON.stringify({ suggestion: "compliant", reason: "补卡时间属于申请日期且已填写原因。" });
    }
    if (approvalType === "shift_swap") {
      const swap = req.mockContext?.swap as { engineCheckResult?: string | null } | undefined;
      try {
        const result = JSON.parse(swap?.engineCheckResult ?? "");
        if (result.valid === true) return JSON.stringify({ suggestion: "compliant", reason: "换班已通过完整班表硬约束校验。" });
      } catch {
        // Safe suspicious response below.
      }
      return JSON.stringify({ suggestion: "suspicious", reason: "换班缺少有效硬约束校验结果，建议人工核实。" });
    }
    const leave = req.mockContext?.leave as
      | { type: string; hours: number; balance: number; reason?: string }
      | undefined;
    if (!leave) {
      return JSON.stringify({
        suggestion: "suspicious",
        reason: "规则不足，建议经理人工核实。",
      });
    }
    // 简单合规规则：时长超常 / 余额不足 → 存疑
    if (leave.hours > leave.balance) {
      return JSON.stringify({
        suggestion: "suspicious",
        reason: `申请时长 ${leave.hours}h 超过可用余额 ${leave.balance}h，建议核查。`,
      });
    }
    if (leave.type === "sick" && leave.hours > 24 && !leave.reason) {
      return JSON.stringify({
        suggestion: "suspicious",
        reason: "病假超过 3 天但未填写事由/证明，建议补充材料。",
      });
    }
    if (leave.hours > 40) {
      return JSON.stringify({
        suggestion: "suspicious",
        reason: `单次请假 ${leave.hours}h 时长较长，建议经理确认排班影响。`,
      });
    }
    return JSON.stringify({
      suggestion: "compliant",
      reason: "类型合规、时长在余额范围内，无明显异常。",
    });
  }

  private scheduleExplain(req: LLMRequest): string {
    const ctx = req.mockContext as
      | {
          note?: string;
          totalAssignments?: number;
          highlights?: string[];
          gaps?: Array<{ date: string; shift: string; shortfall: number }>;
        }
      | undefined;
    if (!ctx) return "已根据优化引擎结果完成排班。";
    const parts: string[] = [];
    parts.push(
      ctx.note && ctx.note !== "未识别到明确的排班偏好"
        ? `已按你的诉求（${ctx.note}）尽量安排。`
        : "已按门店各时段人数需求完成排班。"
    );
    if (ctx.highlights && ctx.highlights.length) {
      parts.push(ctx.highlights.join("；") + "。");
    }
    parts.push(`本周共排 ${ctx.totalAssignments ?? 0} 个班次。`);
    if (ctx.gaps && ctx.gaps.length) {
      const g = ctx.gaps
        .map((x) => `${x.date} ${shiftLabel(x.shift)}缺 ${x.shortfall} 人`)
        .join("，");
      parts.push(`注意：${g}，请关注这些时段人手不足。`);
    } else {
      parts.push("各时段人数均已满足。");
    }
    return parts.join("");
  }
}

function shiftLabel(shift: string): string {
  return shift === "morning" ? "早班" : shift === "afternoon" ? "午班" : "晚班";
}
