import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const manifestPath = resolve(dist, "manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outputPath = resolve(
  root,
  process.env.CHROME_WEBSTORE_ZIP || `forward-accessibility-lens-${manifest.version}-chrome-web-store.zip`
);

await rm(outputPath, { force: true });

const result = spawnSync("zip", ["-qr", outputPath, ".", "-x", "*.DS_Store"], {
  cwd: dist,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Created Chrome Web Store package: ${outputPath}`);
