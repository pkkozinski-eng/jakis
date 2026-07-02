import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Podczas dev proxujemy /api do backendu FastAPI (domyślnie :8000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
