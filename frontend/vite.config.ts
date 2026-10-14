import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],

  // FastAPI mounts web/ at /static, so built asset URLs must be absolute from
  // there. In dev the Vite server serves everything itself, so plain "/" is right.
  base: command === "build" ? "/static/" : "/",

  build: {
    outDir: "../web",
    emptyOutDir: true,
    // Vite injects an inline modulepreload polyfill by default. The app ships
    // `script-src 'self'` (no inline scripts), so it must be switched off.
    modulePreload: { polyfill: false },
    sourcemap: false,
  },

  server: {
    port: 5173,
    // `npm run dev` talks to the FastAPI app running on :8000.
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
}));
