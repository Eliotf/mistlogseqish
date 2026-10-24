import { resolve } from "path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Fixed coverage floors, set just below actual coverage (last raised
 * 2026-10-24 with page titles). They stop coverage falling but
 * never rise on their own. Raise them by hand as tests are added (target:
 * 80 / 75 / 80 / 80). See PRD.md section 7, "Quality gates".
 */
const coverageThresholds = {
  lines: 63,
  branches: 53,
  functions: 57,
  statements: 60,
};

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "~": resolve(__dirname, "app"),
    },
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/evals/**"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.ts", "app/**/*.tsx", "agents/**/*.ts", "workers/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: coverageThresholds,
    },
  },
});
