import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths: the same build works from a domain root (Hugging Face Space) and from a
  // sub-path (GitHub Pages project site) with no rebuild.
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 300,
    rollupOptions: { output: { manualChunks: { react: ["react", "react-dom"] } } },
  },
  server: {
    port: 3002,
    // .trycloudflare.com: a quick tunnel gets a new random subdomain each time it restarts.
    allowedHosts: [".trycloudflare.com"],
  },
});
