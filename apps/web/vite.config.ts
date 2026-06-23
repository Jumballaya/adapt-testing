import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Proxy /api to the Express server so the frontend hits a single origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
