import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const bridge = process.env.SKILLHUB_BRIDGE_URL ?? "http://127.0.0.1:43111";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: bridge,
        changeOrigin: false,
      },
    },
  },
});
