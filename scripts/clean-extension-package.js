import { readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const blockedNames = new Set([".DS_Store"]);

await removeBlockedFiles(dist);

async function removeBlockedFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  });

  await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);

    if (blockedNames.has(entry.name)) {
      await rm(path, { force: true });
      return;
    }

    if (entry.isDirectory()) {
      await removeBlockedFiles(path);
    }
  }));
}
