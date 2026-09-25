import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    // .trycloudflare.com: the quick-tunnel used to expose this dev server
    // publicly gets a new random subdomain each time it's (re)started, so
    // this allows the whole suffix rather than one fixed hostname.
    allowedHosts: [".trycloudflare.com"],
  },
});
