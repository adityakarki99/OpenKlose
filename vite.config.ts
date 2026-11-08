import path from "path";
import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `npm run build` is the canvas the klose server serves (web/dist).
// scripts/build-static.mjs sets VITE_KLOSE_STATIC=1 and VITE_BASE for the
// hosted canvas (web/static): the same app, asking for a repo folder instead
// of talking to a server (see lib/mode.ts).
/**
 * klose-bridge.js: the script a live page loads so the canvas can comment on
 * its elements (see preview/bridge.ts and lib/bridgeProtocol.js). It has to be
 * a single dependency-free file a plain <script src> can load, so it is bundled
 * on its own as an IIFE and emitted next to the app, where the Klose server and
 * the static build both serve it as /klose-bridge.js.
 */
function kloseBridge(): Plugin {
  const entry = path.resolve(__dirname, "preview/bridge.ts");
  async function bundle(): Promise<string> {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      root: __dirname,
      build: {
        write: false,
        minify: true,
        emptyOutDir: false,
        lib: { entry, formats: ["iife"], name: "KloseBridge", fileName: () => "klose-bridge.js" },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ("output" in r ? r.output : []));
    const chunk = outputs.find((o) => o.type === "chunk");
    if (!chunk || chunk.type !== "chunk") throw new Error("klose-bridge.js did not build");
    return chunk.code;
  }
  return {
    name: "klose-bridge",
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "klose-bridge.js", source: await bundle() });
    },
    configureServer(server) {
      server.middlewares.use("/klose-bridge.js", async (_req, res) => {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(await bundle());
      });
    },
  };
}

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
  plugins: [tailwindcss(), react(), kloseBridge()],
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
