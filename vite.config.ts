import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `npm run build` is the canvas the klose server serves (web/dist).
// scripts/build-static.mjs sets VITE_KLOSE_STATIC=1 and VITE_BASE for the
// hosted canvas (web/static): the same app, asking for a repo folder instead
// of talking to a server (see lib/mode.ts).
const isStatic = process.env.VITE_KLOSE_STATIC === "1";

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  server: {
    port: 5170,
    host: "0.0.0.0",
    proxy: {
      "/api": "http://localhost:5171",
    },
  },
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  build: {
    outDir: isStatic ? "web/static" : "web/dist",
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, "index.html"),
        preview: path.resolve(__dirname, "preview.html"),
      },
    },
  },
});
