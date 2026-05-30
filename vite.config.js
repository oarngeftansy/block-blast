import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/block-blast/", // GitHub Pages 项目站点路径
  plugins: [react()],
});
