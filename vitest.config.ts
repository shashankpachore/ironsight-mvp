import path from "node:path";
import dotenv from "dotenv";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "vitest/config";

// Ensure DATABASE_URL matches the app (Vitest does not load .env by default).
loadEnvConfig(path.resolve(__dirname));
dotenv.config({ path: ".env.test", override: true });

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
    setupFiles: [path.resolve(__dirname, "tests/vitest.setup.ts")],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
