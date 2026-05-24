import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// C-MX-08 D-OC-02 ratificado: porta BFF = 3737. Frontend dev server roda
// em porta separada (5173) e proxy /api → BFF pra evitar CORS.
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3737",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        // SSE precisa de timeout longo + WS-like handling. Vite proxy
        // (http-proxy) lida com Transfer-Encoding chunked nativamente.
        ws: false,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
  },
});
