import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The renderer is loaded from disk (file://), so asset paths must be relative.
export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist/renderer", emptyOutDir: true },
});
