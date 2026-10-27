// Runs after `vite build`. Usage: node scripts/postbuild.mjs standalone|web
//
// 1. Adds a strict Content Security Policy to the built HTML. Scripts are only
//    allowed if their exact contents match a hash, and the page may not contact
//    any server (connect-src 'none'), load remote fonts, images or frames.
// 2. Checks the HTML doesn't reference anything on the internet.
// 3. standalone: renames the file to Gen3MapBlueprint.html.
//    web: stamps the service worker with a build id so updates replace old caches.

import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const mode = process.argv[2];
if (mode !== "standalone" && mode !== "web") {
  console.error("Usage: node scripts/postbuild.mjs standalone|web");
  process.exit(1);
}
const outDir = mode === "web" ? "dist-web" : "dist-standalone";
const htmlPath = join(outDir, "index.html");
let html = readFileSync(htmlPath, "utf8");

// --- 1. Content Security Policy ---------------------------------------------
const hashes = [];
for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  if (/\bsrc=/.test(m[0].slice(0, m[0].indexOf(">")))) {
    console.error("A <script src=…> was found in the built HTML. Everything must be inlined.");
    process.exit(1);
  }
  hashes.push(`'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
}

const csp = [
  "default-src 'none'",
  `script-src ${hashes.join(" ")}`,
  "style-src 'unsafe-inline'",
  mode === "web" ? "img-src 'self' data: blob:" : "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  mode === "web" ? "worker-src 'self' blob:" : "worker-src blob:",
  mode === "web" ? "manifest-src 'self'" : null,
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
]
  .filter(Boolean)
  .join("; ");

html = html.replace(/<meta charset="UTF-8"\s*\/?>/i, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
if (!html.includes("Content-Security-Policy")) {
  console.error("Could not insert the Content Security Policy.");
  process.exit(1);
}

// --- 2. No remote references -------------------------------------------------
const remote = [...html.matchAll(/\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//gi)];
if (remote.length) {
  console.error(`The built HTML references remote URLs (${remote.length}). The app must work offline.`);
  process.exit(1);
}

writeFileSync(htmlPath, html, "utf8");

// --- 3. Per-mode finishing ---------------------------------------------------
if (mode === "standalone") {
  const finalPath = join(outDir, "Gen3MapBlueprint.html");
  renameSync(htmlPath, finalPath);
  console.log(`Standalone app: ${finalPath} (${(statSync(finalPath).size / 1024).toFixed(0)} KB)`);
} else {
  const swPath = join(outDir, "sw.js");
  if (!existsSync(swPath)) {
    console.error("dist-web/sw.js is missing (it should be copied from web-public/).");
    process.exit(1);
  }
  // Every file in the build is pre-cached for offline use.
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== "sw.js") files.push("./" + relative(outDir, p).split(sep).join("/"));
    }
  };
  walk(outDir);
  const buildId = createHash("sha256").update(html).digest("hex").slice(0, 12);
  const sw = readFileSync(swPath, "utf8")
    .replaceAll("__BUILD_ID__", buildId)
    .replaceAll("__PRECACHE__", JSON.stringify(["./", ...files]));
  if (sw.includes("__BUILD_ID__") || sw.includes("__PRECACHE__")) {
    console.error("sw.js still contains a placeholder.");
    process.exit(1);
  }
  writeFileSync(swPath, sw, "utf8");
  console.log(`Web app: ${outDir}/ (build ${buildId}, ${files.length + 1} files cached for offline use)`);
}
