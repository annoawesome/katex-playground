/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// No framework plugin is needed: Vite 8 transforms TSX with Oxc, and we only
// have to tell it to use React's automatic JSX runtime (`react/jsx-runtime`).
// (We deliberately skip @vitejs/plugin-react to keep the dependency tree small;
// the only thing lost is React Fast Refresh during development.)
export default defineConfig({
  // Relative asset URLs so the built `dist/` folder works from any sub-path
  // (GitHub Pages, a file share, etc.).
  base: "./",
  oxc: {
    jsx: { runtime: "automatic" },
  },
  build: {
    // The bundle is essentially React + KaTeX (~170 kB gzipped), all of which
    // is needed on first paint, so splitting it would not help.
    chunkSizeWarningLimit: 700,
  },
  test: {
    // All tested modules are pure TypeScript; no DOM emulation is required.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
