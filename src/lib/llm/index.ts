import { config } from "../config";
import type { LLMProvider } from "./provider";
import { DeepseekProvider } from "./deepseek";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";

export * from "./provider";

let cached: LLMProvider | null = null;

// 工厂：按 LLM_PROVIDER 选择实现。真实 provider 未配置 Key 时自动降级为 mock 并告警。
export function getLLM(): LLMProvider {
  if (cached) return cached;
  if (config.llm.provider === "deepseek") {
    if (config.llm.deepseekApiKey) {
      cached = new DeepseekProvider();
    } else {
      console.warn(
        "[LLM] LLM_PROVIDER=deepseek 但缺少 DEEPSEEK_API_KEY，已自动降级为 mock。"
      );
      cached = new MockProvider();
    }
  } else if (config.llm.provider === "anthropic") {
    if (config.llm.anthropicApiKey) {
      cached = new AnthropicProvider();
    } else {
      console.warn(
        "[LLM] LLM_PROVIDER=anthropic 但缺少 ANTHROPIC_API_KEY，已自动降级为 mock。"
      );
      cached = new MockProvider();
    }
  } else {
    cached = new MockProvider();
  }
  return cached;
}
