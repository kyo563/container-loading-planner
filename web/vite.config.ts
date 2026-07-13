import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/container-loading-planner/",
  build: {
    sourcemap: true,
    // ExcelJS is loaded only when an XLSX import/export is requested.
    chunkSizeWarningLimit: 1000,
  },
});
