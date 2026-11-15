// Zips dist/<browser>/ into releases/mindfull-<browser>.zip (cross-platform).
// Usage: node scripts/zip.js chrome|firefox|all
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const root = path.resolve(__dirname, "..");
const arg = process.argv[2] || "all";
const targets = arg === "all" ? ["chrome", "firefox"] : [arg];

fs.mkdirSync(path.join(root, "releases"), { recursive: true });

for (const target of targets) {
  const src = path.join(root, "dist", target);
  if (!fs.existsSync(src)) {
    console.error(`Missing ${src}; run the build first.`);
    process.exit(1);
  }
  const out = path.join(root, "releases", `mindfull-${target}.zip`);
  fs.rmSync(out, { force: true });
  const zip = new AdmZip();
  zip.addLocalFolder(src);
  zip.writeZip(out);
  console.log(`Wrote ${path.relative(root, out)}`);
}
