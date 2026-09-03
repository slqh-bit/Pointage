import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Le moteur de règles reçoit des tests property-based (fast-check) en P3.
  },
});
