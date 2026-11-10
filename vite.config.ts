import { defineConfig } from "vite";

// `base: "./"` makes the build work from any GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) without extra configuration.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
