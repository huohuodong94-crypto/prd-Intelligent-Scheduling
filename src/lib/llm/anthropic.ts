import { config } from "../config";
import type { LLMProvider, LLMRequest, LLMResponse } from "./provider";

// 真实 Claude API 调用（Messages API）。填入 ANTHROPIC_API_KEY 后由工厂选中。
// 不引入 SDK，直接用 fetch，保持 provider 可插拔、依赖最小。
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  async complete(req: LLMRequest): Promise<LLMResponse> {
    if (!config.llm.anthropicApiKey) {
      throw new Error(
        "LLM_PROVIDER=anthropic 但未配置 ANTHROPIC_API_KEY。请在 .env 填入 Key，或将 LLM_PROVIDER 设为 mock。"
      );
    }

    const res = await fetch(`${config.llm.anthropicBaseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.llm.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: 1024,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Claude API 调用失败 (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      model?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    const text =
      data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("") ?? "";
    // 优先记录响应里回报的模型名（可能与请求的别名不同）
    return { text: text.trim(), provider: this.name, model: data.model || req.model };
  }
}
