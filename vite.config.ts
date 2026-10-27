// Build configuration.
//
//   npm run dev               → local development server (http://localhost:5173)
//   npm run build:standalone  → dist-standalone/Gen3MapBlueprint.html, one self-contained file
//   npm run build:web         → dist-web/, the same page plus a manifest, service worker and
//                               icons, for hosting (GitHub Pages) and installing on an iPad
//
// Both builds inline all code and styles into one HTML file. scripts/postbuild.mjs
// then adds the strict Content Security Policy.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => {
  const web = mode === "web";
  return {
    base: "./",
    plugins: [
      react(),
      viteSingleFile({ removeViteModuleLoader: true }),
      {
        name: "web-links",
        transformIndexHtml(html: string) {
          const links = web
            ? '<link rel="manifest" href="./manifest.webmanifest" />\n    <link rel="icon" href="./icons/icon-192.png" />\n    <link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />'
            : "";
          return html.replace("<!--web-links-->", links);
        },
      },
    ],
    // Only the hosted build ships the manifest, service worker and icons.
    publicDir: web ? "web-public" : false,
    build: {
      outDir: web ? "dist-web" : "dist-standalone",
      emptyOutDir: true,
      // The standalone file must not load anything from elsewhere, so inline everything.
      assetsInlineLimit: 100_000_000,
      chunkSizeWarningLimit: 5_000,
      modulePreload: false,
    },
    server: {
      // Dev server: only reachable from this computer.
      host: "localhost",
      port: 5173,
      strictPort: false,
    },
  };
});
