import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A relative base lets the same build run from any GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
