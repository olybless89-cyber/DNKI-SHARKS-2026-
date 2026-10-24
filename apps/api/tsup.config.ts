import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/scripts/migrate.ts", "src/scripts/create-admin.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle the workspace package; keep npm dependencies external.
  noExternal: ["@dnki/shared"],
});
