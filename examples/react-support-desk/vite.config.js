import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    server: {
      fs: {
        deny: [
          ".env", ".env.*", "*.{crt,pem,key,p12,pfx,cer,der}", ".npmrc", ".yarnrc.yml", "**/.git/**",
          "**/.demo-accounts.json", "**/.demo-state.json", "**/.verification*.json",
          "**/.yuncms/**", "**/uploads/**",
        ],
      },
      proxy: {
        "/api": {
          target: env.VITE_CMS_TARGET || "http://127.0.0.1:3058",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
