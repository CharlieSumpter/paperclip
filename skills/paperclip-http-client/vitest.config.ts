import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "skill:paperclip-http-client",
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
  },
});
