import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// C-MX-08 D-OC-02 ratificado: porta BFF = 3737. Frontend dev server roda
// em porta separada (5173 default) e proxy ao BFF via /api.
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
  },
});
