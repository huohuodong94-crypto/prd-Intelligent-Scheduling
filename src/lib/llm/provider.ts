// 统一的 LLM Provider 封装层。业务代码只依赖这个接口，不直接耦合任何厂商 SDK。
// 通过 LLM_PROVIDER 环境变量在 mock / deepseek / anthropic 间切换，填入 Key 即可切真实调用。

export type LLMFeature =
  | "assistant"
  | "schedule_parse"
  | "audit_check"
  | "schedule_explain";

export type LLMRequest = {
  system: string;
  user: string;
  model: string;
  feature: LLMFeature;
  // 期望严格 JSON 输出（解析/审批场景）
  jsonMode?: boolean;
  // 仅供 mock provider 使用的结构化上下文；真实 provider 会忽略它。
  // 这样降级实现也能给出确定性且正确的结果，真实路径保持干净。
  mockContext?: Record<string, unknown>;
};

// 返回实际调用信息：埋点必须记录真实的 provider / model，
// 而不是配置里期望的模型名（mock 降级时两者会不一致）。
export type LLMResponse = {
  text: string;
  provider: string;
  model: string;
};

export interface LLMProvider {
  readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
}
