import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "external-sqlite",
      resolveId(source) {
        if (source === "node:sqlite" || source === "sqlite") {
          return { id: "node:sqlite", external: true };
        }
      }
    }
  ],
  test: {
    environment: "node"
  }
});
