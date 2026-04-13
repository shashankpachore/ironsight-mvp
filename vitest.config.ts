import path from "node:path";
import dotenv from "dotenv";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "vitest/config";

dotenv.config({ path: ".env.test" });

// Ensure DATABASE_URL matches the app (Vitest does not load .env by default).
loadEnvConfig(path.resolve(__dirname));

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
