import { defineConfig, mergeConfig } from "vitest/config";
import unitConfig from "./vitest.config";

const integrationConfig = mergeConfig(
  unitConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["tests/integration/**/*.test.ts"],
      fileParallelism: false,
    },
  })
);

if (integrationConfig.test) {
  integrationConfig.test.exclude = [
    "node_modules/**",
    "tests/e2e/**",
    "tests/visual/**",
  ];
}

export default integrationConfig;
