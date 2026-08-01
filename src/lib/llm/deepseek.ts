import { config } from "../config";
import type { LLMProvider, LLMRequest, LLMResponse } from "./provider";

// 真实 DeepSeek API 调用（OpenAI 兼容的 /chat/completions）。
// 填入 DEEPSEEK_API_KEY 且 LLM_PROVIDER=deepseek 后由工厂选中。
// 不引入 SDK，直接用 fetch，保持 provider 可插拔、依赖最小。
export class DeepseekProvider implements LLMProvider {
  readonly name = "deepseek";

  async complete(req: LLMRequest): Promise<LLMResponse> {
    if (!config.llm.deepseekApiKey) {
      throw new Error(
        "LLM_PROVIDER=deepseek 但未配置 DEEPSEEK_API_KEY。请在 .env 填入 Key，或将 LLM_PROVIDER 设为 mock。"
      );
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: 1024,
    };

    // 解析/审批等结构化场景：强制 JSON 输出并压低温度，保证可解析性
    if (req.jsonMode) {
      body.response_format = { type: "json_object" };
      body.temperature = 0.2;
    } else if (req.feature === "schedule_explain") {
      body.temperature = 0.5;
    } else if (req.feature === "assistant") {
      body.temperature = 0.7;
    }

    const res = await fetch(`${config.llm.deepseekBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.llm.deepseekApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DeepSeek API 调用失败 (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    // 优先记录响应里回报的模型名（可能与请求的别名不同）
    return { text: text.trim(), provider: this.name, model: data.model || req.model };
  }
}
