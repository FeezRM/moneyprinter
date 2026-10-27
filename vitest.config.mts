import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // Integration tests share one database; run files serially.
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgres://postgres@localhost:5433/moneyprinter_test",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-test-secret",
      BETTER_AUTH_URL: "http://localhost:3000",
      INSTAGRAM_APP_ID: "test-app",
      INSTAGRAM_APP_SECRET: "test-app-secret",
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "test-verify",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
