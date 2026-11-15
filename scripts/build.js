#!/usr/bin/env node
// scripts/build.js — bundles the extension for Chrome and/or Firefox into dist/<browser>/
// Usage: node scripts/build.js [--browser=chrome|firefox|all] [--dev]
//   --dev  defines __DEV__=true, which adds 1-minute unlock/cooldown/focus options for testing.

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const browserArg = args.find((a) => a.startsWith("--browser="));
const browser = browserArg ? browserArg.split("=")[1] : "all";
const dev = args.includes("--dev");
const browsers = browser === "all" ? ["chrome", "firefox"] : [browser];

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const pkg = require(path.join(ROOT, "package.json"));

// Bundled entry points -> dist/<browser>/src/<name>.js
const ENTRIES = {
  background: "background/index.js",
  pause: "pause/pause.js",
  popup: "popup/popup.js",
  options: "options/options.js",
};

// Static files copied into dist/<browser>/src/
const STATIC = [
  "pause/pause.html",
  "pause/pause.css",
  "popup/popup.html",
  "popup/popup.css",
  "options/options.html",
  "options/options.css",
  "shared/ui.css",
];

const ICONS = ["icon16.png", "icon48.png", "icon128.png"];

async function buildForBrowser(target) {
  if (!["chrome", "firefox"].includes(target)) throw new Error(`Unknown browser: ${target}`);
  const outDir = path.join(ROOT, "dist", target);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "icons"), { recursive: true });

  for (const [name, entry] of Object.entries(ENTRIES)) {
    await esbuild.build({
      entryPoints: [path.join(SRC, entry)],
      bundle: true,
      outfile: path.join(outDir, "src", `${name}.js`),
      format: "iife",
      target: "es2020",
      define: { __DEV__: dev ? "true" : "false" },
      legalComments: "none",
      logLevel: "warning",
    });
  }

  for (const f of STATIC) {
    fs.copyFileSync(path.join(SRC, f), path.join(outDir, "src", path.basename(f)));
  }

  for (const icon of ICONS) {
    fs.copyFileSync(path.join(ROOT, "icons", icon), path.join(outDir, "icons", icon));
  }

  // Manifest: per-browser file, version kept in sync with package.json.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifests", `manifest.${target}.json`), "utf8"));
  manifest.version = pkg.version;
  if (dev) manifest.name += " (dev)";
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`✓ Built for ${target}${dev ? " (dev)" : ""} → dist/${target}/`);
}

(async () => {
  for (const b of browsers) await buildForBrowser(b);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
