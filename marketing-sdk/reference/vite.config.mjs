import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "marketing-sdk/reference",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "127.0.0.1" },
});
