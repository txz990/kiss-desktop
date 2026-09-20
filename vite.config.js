import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 仅构建渲染进程（src/ui），输出到 dist/renderer。
// 主进程（electron/main.js）与引擎层（src/engine）由 Electron 直接以 ESM 加载，不经 Vite。
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
