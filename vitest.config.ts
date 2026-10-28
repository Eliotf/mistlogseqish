import { resolve } from "path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Fixed coverage floors, set just below actual coverage (last raised
 * 2026-10-28 with links (2.5a)). They stop coverage falling but
 * never rise on their own. Raise them by hand as tests are added (target:
 * 80 / 75 / 80 / 80). See PRD.md section 7, "Quality gates".
 */
const coverageThresholds = {
  lines: 78,
  branches: 69,
  functions: 77,
  statements: 76,
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
