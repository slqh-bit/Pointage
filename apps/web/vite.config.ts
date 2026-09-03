import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // En production, IIS sert le build statique et proxifie /api et /iclock (ops/iis).
      "/api": "http://localhost:8080",
      "/iclock": "http://localhost:8080",
    },
  },
});
